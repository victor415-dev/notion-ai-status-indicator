(() => {
	"use strict";

	// M1（命门）：在页面主世界（world: MAIN）拦截 fetch，识别 Notion AI 流式请求，
	// 判定 thinking / responding / done。现阶段先打日志 + 广播事件，供人工确认检测准确性。
	// 确认真正的 AI 流式端点后，再收敛下面的 AI_URL_HINTS（见 docs/M1-detection.md）。
	const TAG = "[NAI-Indicator]";

	// M1 确认：Notion AI 对话流式端点。
	const AI_URL_HINTS = [
		"/api/v3/runinferencetranscript",
	];

	function isAiUrl(url) {
		try {
			const u = String(url).toLowerCase();
			return AI_URL_HINTS.some((h) => u.includes(h));
		} catch (e) {
			return false;
		}
	}

	function emit(state, extra) {
		const detail = Object.assign(
			{ __naiIndicator: true, source: "interceptor", state, at: Date.now() },
			extra || {},
		);
		// M1：先用日志肉眼确认时序是否准确
		console.debug(TAG, state, detail);
		try {
			window.postMessage(detail, "*");
		} catch (e) {}
	}

	async function consumeStream(body, reqId, url) {
		let first = true;
		try {
			const reader = body.getReader();
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				if (first && value && value.byteLength) {
					first = false;
					emit("responding", { reqId, url });
				}
			}
		} catch (e) {
			// 读流异常也视为结束
		} finally {
			emit("done", { reqId, url });
		}
	}

	const origFetch = window.fetch;
	if (typeof origFetch === "function") {
		window.fetch = function (input, init) {
			const url =
				input && typeof input === "object" && "url" in input ? input.url : input;
			const aiHit = isAiUrl(url);
			const reqId = aiHit ? Math.random().toString(36).slice(2) : null;
			if (aiHit) emit("thinking", { url: String(url), reqId });

			const p = origFetch.apply(this, arguments);
			if (!aiHit) return p;

			return p
				.then((resp) => {
					try {
						if (resp && resp.body) {
							// 用 clone() 读流，不影响页面对原始响应的消费
							consumeStream(resp.clone().body, reqId, String(url));
						} else {
							emit("done", { url: String(url), reqId });
						}
					} catch (e) {
						emit("done", { url: String(url), reqId });
					}
					return resp;
				})
				.catch((err) => {
					emit("done", { url: String(url), reqId, error: true });
					throw err;
				});
		};
	}
})();

// ===== T-001 additions (only additive) =====
// 在不改动原有检测逻辑的前提下，额外解析 Notion AI 请求体并广播 lastInput（解析失败置空，绝不抛错）。
(() => {
	"use strict";

	const AI_URL_HINTS = [
		"/api/v3/runinferencetranscript",
	];

	function isAiUrl(url) {
		try {
			const u = String(url).toLowerCase();
			return AI_URL_HINTS.some((h) => u.includes(h));
		} catch (e) {
			return false;
		}
	}

	function safeJsonParse(text) {
		try {
			return JSON.parse(text);
		} catch (e) {
			return null;
		}
	}

	function extractLastInputFromBody(body) {
		// 这里尽量宽松地解析：支持 string / object / URLSearchParams / FormData
		try {
			if (!body) return "";
			if (typeof body === "string") {
				const j = safeJsonParse(body);
				return extractFromJson(j) || "";
			}
			if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) {
				const t = body.get("input") || body.get("text") || "";
				return String(t || "").slice(0, 80);
			}
			if (typeof FormData !== "undefined" && body instanceof FormData) {
				const t = body.get("input") || body.get("text") || "";
				return String(t || "").slice(0, 80);
			}
			if (typeof body === "object") {
				return extractFromJson(body) || "";
			}
			return "";
		} catch (e) {
			return "";
		}
	}

	function extractFromJson(j) {
		try {
			if (!j || typeof j !== "object") return "";
			// 常见形态：messages: [{ role, content }]
			const messages = Array.isArray(j.messages) ? j.messages : null;
			if (messages && messages.length) {
				for (let i = messages.length - 1; i >= 0; i--) {
					const m = messages[i];
					if (!m) continue;
					const role = (m.role || m.author || "").toLowerCase();
					if (role && role !== "user") continue;
					const content = typeof m.content === "string" ? m.content : (m.text || "");
					if (content) return String(content).trim().slice(0, 80);
				}
			}
			// 退化：input / prompt / text
			const t = j.input || j.prompt || j.text || "";
			return t ? String(t).trim().slice(0, 80) : "";
		} catch (e) {
			return "";
		}
	}

	function broadcastLastInput(lastInput) {
		try {
			window.postMessage({
				__naiIndicator: true,
				source: "interceptor",
				state: "idle",
				at: Date.now(),
				lastInput: lastInput || "",
			}, "*");
		} catch (e) {}
	}

	const prevFetch = window.fetch;
	if (typeof prevFetch !== "function") return;

	window.fetch = function (input, init) {
		let url = input;
		try {
			url = input && typeof input === "object" && "url" in input ? input.url : input;
		} catch (e) {}

		try {
			if (isAiUrl(url)) {
				const body = init && init.body;
				const lastInput = extractLastInputFromBody(body);
				broadcastLastInput(lastInput);
			}
		} catch (e) {
			// 绝不影响页面
		}

		return prevFetch.apply(this, arguments);
	};
})();
