(() => {
	"use strict";

	// M1（命门）：在页面主世界（world: MAIN）拦截 fetch，识别 Notion AI 流式请求，
	// 判定 thinking / responding / done。现阶段先打日志 + 广播事件，供人工确认检测准确性。
	// 确认真正的 AI 流式端点后，再收敛下面的 AI_URL_HINTS（见 docs/M1-detection.md）。
	const TAG = "[NAI-Indicator]";

	// ⚠️ M1 待确认：候选特征串，均为小写以便匹配。请按实际端点收敛。
	const AI_URL_HINTS = [
		"runinference",
		"getcompletion",
		"inferencetranscript",
		"assistant",
		"/ai/",
		"ai-agent",
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
