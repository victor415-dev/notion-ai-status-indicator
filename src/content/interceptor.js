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
	const REPLAY_BUFFER_MAX = 20;
	const replayBuffer = [];

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

	function findTranscriptId(value, depth) {
		if (!value || depth > 6) return "";
		if (typeof value !== "object") return "";
		if (Array.isArray(value)) {
			for (const item of value) {
				const found = findTranscriptId(item, depth + 1);
				if (found) return found;
			}
			return "";
		}
		const direct = value.transcriptId || value.transcript_id || value.transcriptID;
		if (direct) return String(direct);
		if (value.transcript && typeof value.transcript === "object") {
			const nested = value.transcript.id || value.transcript.transcriptId;
			if (nested) return String(nested);
		}
		for (const key of Object.keys(value)) {
			const found = findTranscriptId(value[key], depth + 1);
			if (found) return found;
		}
		return "";
	}

	function extractTranscriptIdFromBody(body) {
		try {
			if (!body) return "";
			if (typeof body === "string") return findTranscriptId(safeJsonParse(body), 0);
			if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) {
				return body.get("transcriptId") || body.get("transcript_id") || "";
			}
			if (typeof FormData !== "undefined" && body instanceof FormData) {
				return String(body.get("transcriptId") || body.get("transcript_id") || "");
			}
			if (typeof body === "object") return findTranscriptId(body, 0);
			return "";
		} catch (e) {
			return "";
		}
	}

	function conversationIdFromUrl() {
		try {
			return new URL(window.location && window.location.href ? window.location.href : "").searchParams.get("t") || "";
		} catch (e) {
			return "";
		}
	}

	function getConversationId(input, init) {
		const fromBody = extractTranscriptIdFromBody(init && init.body);
		if (fromBody) return fromBody;
		const fromUrl = conversationIdFromUrl();
		if (fromUrl) return fromUrl;
		console.debug(TAG, "conversation fallback tabId compatibility", { at: Date.now() });
		return "";
	}

	function emit(state, extra) {
		const detail = Object.assign(
			{ __naiIndicator: true, source: "interceptor", state, at: Date.now() },
			extra || {},
		);
		replayBuffer.push(detail);
		if (replayBuffer.length > REPLAY_BUFFER_MAX) replayBuffer.shift();
		// M1：先用日志肉眼确认时序是否准确
		console.debug(TAG, "broadcast", state, detail);
		try {
			window.postMessage(detail, "*");
		} catch (e) {}
	}

	function replayBufferedEvents() {
		for (const detail of replayBuffer) {
			try {
				console.debug(TAG, "replay", detail.state, detail);
				window.postMessage(Object.assign({}, detail, { replay: true }), "*");
			} catch (e) {}
		}
	}

	if (typeof window.addEventListener === "function") {
		window.addEventListener("message", (ev) => {
			if (ev.source !== window) return;
			const d = ev.data;
			if (!d || d.__naiIndicatorReady !== true) return;
			replayBufferedEvents();
		});
	}

	function logStream(event, reqId, url) {
		console.debug(TAG, `stream ${event}`, { reqId, url, at: Date.now() });
	}

	async function consumeStream(body, reqId, url, conversationId) {
		let first = true;
		try {
			const reader = body.getReader();
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				if (first && value && value.byteLength) {
					first = false;
					emit("responding", { reqId, url, conversationId, pageConversationId: conversationIdFromUrl() });
				}
			}
		} catch (e) {
			// 读流异常也视为结束
		} finally {
			logStream("close", reqId, url);
			emit("done", { reqId, url, conversationId, pageConversationId: conversationIdFromUrl(), streamEvent: "close", doneReason: "stream-closed" });
		}
	}

	const origFetch = window.fetch;
	if (typeof origFetch === "function") {
		window.fetch = function (input, init) {
			const url =
				input && typeof input === "object" && "url" in input ? input.url : input;
			const aiHit = isAiUrl(url);
			const reqId = aiHit ? Math.random().toString(36).slice(2) : null;
			const conversationId = aiHit ? getConversationId(input, init) : "";
			if (aiHit) {
				logStream("open", reqId, String(url));
				emit("thinking", { url: String(url), reqId, conversationId, pageConversationId: conversationIdFromUrl(), streamEvent: "open" });
			}

			const p = origFetch.apply(this, arguments);
			if (!aiHit) return p;

			return p
				.then((resp) => {
					try {
						if (resp && resp.body) {
							// 用 clone() 读流，不影响页面对原始响应的消费
							consumeStream(resp.clone().body, reqId, String(url), conversationId);
						} else {
							logStream("close", reqId, String(url));
							emit("done", { url: String(url), reqId, conversationId, pageConversationId: conversationIdFromUrl(), streamEvent: "close", doneReason: "stream-closed" });
						}
					} catch (e) {
						logStream("close", reqId, String(url));
						emit("done", { url: String(url), reqId, conversationId, pageConversationId: conversationIdFromUrl(), streamEvent: "close", doneReason: "stream-closed" });
					}
					return resp;
				})
				.catch((err) => {
					logStream("close", reqId, String(url));
					emit("done", { url: String(url), reqId, conversationId, pageConversationId: conversationIdFromUrl(), streamEvent: "close", doneReason: "stream-closed", error: true });
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

	function findTranscriptId(value, depth) {
		if (!value || depth > 6) return "";
		if (typeof value !== "object") return "";
		if (Array.isArray(value)) {
			for (const item of value) {
				const found = findTranscriptId(item, depth + 1);
				if (found) return found;
			}
			return "";
		}
		const direct = value.transcriptId || value.transcript_id || value.transcriptID;
		if (direct) return String(direct);
		if (value.transcript && typeof value.transcript === "object") {
			const nested = value.transcript.id || value.transcript.transcriptId;
			if (nested) return String(nested);
		}
		for (const key of Object.keys(value)) {
			const found = findTranscriptId(value[key], depth + 1);
			if (found) return found;
		}
		return "";
	}

	function extractTranscriptIdFromBody(body) {
		try {
			if (!body) return "";
			if (typeof body === "string") return findTranscriptId(safeJsonParse(body), 0);
			if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) {
				return body.get("transcriptId") || body.get("transcript_id") || "";
			}
			if (typeof FormData !== "undefined" && body instanceof FormData) {
				return String(body.get("transcriptId") || body.get("transcript_id") || "");
			}
			if (typeof body === "object") return findTranscriptId(body, 0);
			return "";
		} catch (e) {
			return "";
		}
	}

	function conversationIdFromUrl() {
		try {
			return new URL(window.location && window.location.href ? window.location.href : "").searchParams.get("t") || "";
		} catch (e) {
			return "";
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

	function broadcastLastInput(lastInput, conversationId) {
		try {
			window.postMessage({
				__naiIndicator: true,
				source: "interceptor",
				at: Date.now(),
				lastInput: lastInput || "",
				conversationId: conversationId || "",
				pageConversationId: conversationIdFromUrl(),
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
				const conversationId = extractTranscriptIdFromBody(body) || conversationIdFromUrl();
				broadcastLastInput(lastInput, conversationId);
			}
		} catch (e) {
			// 绝不影响页面
		}

		return prevFetch.apply(this, arguments);
	};
})();
