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

	function decodeEscapedText(value) {
		const raw = String(value || "");
		const parsed = safeJsonParse(raw);
		if (typeof parsed === "string") return parsed;
		if (!/\\(?:u[0-9a-fA-F]{4}|[\\"/bfnrt])/.test(raw)) return raw;
		let decoded = "";
		for (let index = 0; index < raw.length; index += 1) {
			if (raw[index] !== "\\" || index + 1 >= raw.length) {
				decoded += raw[index];
				continue;
			}
			const escape = raw[index + 1];
			const simple = { "\\": "\\", "\"": "\"", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
			if (Object.prototype.hasOwnProperty.call(simple, escape)) {
				decoded += simple[escape];
				index += 1;
				continue;
			}
			if (escape === "u" && /^[0-9a-fA-F]{4}$/.test(raw.slice(index + 2, index + 6))) {
				const unit = parseInt(raw.slice(index + 2, index + 6), 16);
				const nextEscape = raw.slice(index + 6, index + 12);
				if (unit >= 0xd800 && unit <= 0xdbff && /^\\u[0-9a-fA-F]{4}$/.test(nextEscape)) {
					const low = parseInt(nextEscape.slice(2), 16);
					if (low >= 0xdc00 && low <= 0xdfff) {
						decoded += String.fromCodePoint(0x10000 + ((unit - 0xd800) << 10) + low - 0xdc00);
						index += 11;
						continue;
					}
				}
				decoded += String.fromCharCode(unit);
				index += 5;
				continue;
			}
			decoded += `\\${escape}`;
			index += 1;
		}
		return decoded;
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

	function looksLikeDisplayText(text) {
		const s = String(text || "").trim();
		if (!s) return false;
		if (/^https?:\/\//i.test(s)) return false;
		if (/^[a-z0-9_-]{16,}$/i.test(s)) return false;
		if (/^[{}[\]",:0-9.\s_-]+$/.test(s)) return false;
		return /[\p{L}\p{N}]/u.test(s);
	}

	function collectTextDeltas(value, out, depth, parentKey) {
		if (depth > 8 || value == null) return;
		if (typeof value === "string") {
			const key = String(parentKey || "").toLowerCase();
			const textKeys = new Set([
				"text",
				"plaintext",
				"plain_text",
				"content",
				"markdown",
				"delta",
				"answer",
				"message",
			]);
			const skipKeys = new Set([
				"id",
				"uuid",
				"transcriptid",
				"transcript_id",
				"requestid",
				"request_id",
				"spaceid",
				"space_id",
				"blockid",
				"block_id",
				"role",
				"type",
				"event",
				"status",
				"url",
				"href",
				"source",
				"traceid",
				"trace_id",
				"createdat",
				"created_at",
				"updatedat",
				"updated_at",
				"model",
			]);
			if (!textKeys.has(key) || skipKeys.has(key)) return;
			const decoded = decodeEscapedText(value);
			if (looksLikeDisplayText(decoded)) out.push(decoded.trim());
			return;
		}
		if (typeof value !== "object") return;
		if (Array.isArray(value)) {
			for (const item of value) collectTextDeltas(item, out, depth + 1, parentKey);
			return;
		}
		for (const key of Object.keys(value)) {
			collectTextDeltas(value[key], out, depth + 1, key);
		}
	}

	function parseLinePayload(line) {
		let text = String(line || "").trim();
		if (!text) return null;
		if (text.startsWith("data:")) text = text.slice(5).trim();
		if (!text || text === "[DONE]") return null;
		return safeJsonParse(text);
	}

	function extractReplyDelta(chunkText) {
		try {
			const out = [];
			const lines = String(chunkText || "").split(/\r?\n/);
			for (const line of lines) {
				const parsed = parseLinePayload(line);
				if (parsed) collectTextDeltas(parsed, out, 0, "");
			}
			if (!out.length) {
				const parsed = safeJsonParse(String(chunkText || "").trim());
				if (parsed) collectTextDeltas(parsed, out, 0, "");
			}
			return out.join("").trim();
		} catch (e) {
			return "";
		}
	}

	function appendReply(existing, delta) {
		const next = String(delta || "").trim();
		if (!next) return existing || "";
		const current = String(existing || "");
		let merged = current;
		if (!merged) {
			merged = next;
		} else if (next.startsWith(merged)) {
			merged = next;
		} else if (!merged.endsWith(next)) {
			merged += next;
		}
		return merged.length > 240 ? merged.slice(-240) : merged;
	}

	async function consumeStream(body, reqId, url, conversationId) {
		let first = true;
		let lastReply = "";
		const decoder = typeof TextDecoder !== "undefined" ? new TextDecoder() : null;
		let textBuffer = "";
		try {
			const reader = body.getReader();
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				if (first && value && value.byteLength) {
					first = false;
					emit("responding", { reqId, url, conversationId, pageConversationId: conversationIdFromUrl() });
				}
				if (decoder && value && value.byteLength) {
					textBuffer += decoder.decode(value, { stream: true });
					let parseText = "";
					const cut = textBuffer.lastIndexOf("\n");
					if (cut >= 0) {
						parseText = textBuffer.slice(0, cut + 1);
						textBuffer = textBuffer.slice(cut + 1);
					} else if (textBuffer.length > 8192) {
						parseText = textBuffer;
						textBuffer = "";
					}
					const delta = parseText ? extractReplyDelta(parseText) : "";
					if (delta) {
						lastReply = appendReply(lastReply, delta);
						emit("responding", { reqId, url, conversationId, pageConversationId: conversationIdFromUrl(), lastReply });
					}
				}
			}
			if (decoder) {
				textBuffer += decoder.decode();
				const tailDelta = extractReplyDelta(textBuffer);
				if (tailDelta) {
					lastReply = appendReply(lastReply, tailDelta);
					emit("responding", { reqId, url, conversationId, pageConversationId: conversationIdFromUrl(), lastReply });
				}
			}
		} catch (e) {
			// 读流异常也视为结束
		} finally {
			logStream("close", reqId, url);
			emit("done", { reqId, url, conversationId, pageConversationId: conversationIdFromUrl(), streamEvent: "close", doneReason: "stream-closed", lastReply });
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

	function decodeEscapedText(value) {
		const raw = String(value || "");
		const parsed = safeJsonParse(raw);
		if (typeof parsed === "string") return parsed;
		if (!/\\(?:u[0-9a-fA-F]{4}|[\\"/bfnrt])/.test(raw)) return raw;
		let decoded = "";
		for (let index = 0; index < raw.length; index += 1) {
			if (raw[index] !== "\\" || index + 1 >= raw.length) {
				decoded += raw[index];
				continue;
			}
			const escape = raw[index + 1];
			const simple = { "\\": "\\", "\"": "\"", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
			if (Object.prototype.hasOwnProperty.call(simple, escape)) {
				decoded += simple[escape];
				index += 1;
				continue;
			}
			if (escape === "u" && /^[0-9a-fA-F]{4}$/.test(raw.slice(index + 2, index + 6))) {
				const unit = parseInt(raw.slice(index + 2, index + 6), 16);
				const nextEscape = raw.slice(index + 6, index + 12);
				if (unit >= 0xd800 && unit <= 0xdbff && /^\\u[0-9a-fA-F]{4}$/.test(nextEscape)) {
					const low = parseInt(nextEscape.slice(2), 16);
					if (low >= 0xdc00 && low <= 0xdfff) {
						decoded += String.fromCodePoint(0x10000 + ((unit - 0xd800) << 10) + low - 0xdc00);
						index += 11;
						continue;
					}
				}
				decoded += String.fromCharCode(unit);
				index += 5;
				continue;
			}
			decoded += `\\${escape}`;
			index += 1;
		}
		return decoded;
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
				return decodeEscapedText(t).slice(0, 80);
			}
			if (typeof FormData !== "undefined" && body instanceof FormData) {
				const t = body.get("input") || body.get("text") || "";
				return decodeEscapedText(t).slice(0, 80);
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
					if (content) return decodeEscapedText(content).trim().slice(0, 80);
				}
			}
			// 退化：input / prompt / text
			const t = j.input || j.prompt || j.text || "";
			return t ? decodeEscapedText(t).trim().slice(0, 80) : "";
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
