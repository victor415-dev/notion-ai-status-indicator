chrome.runtime.onMessage.addListener((msg) => {
	if (!msg || msg.type !== "NAI_PLAY_SOUND") return;
	const el = document.getElementById("nai-ding");
	if (!el) return;
	try {
		el.currentTime = 0;
		el.play().catch(() => {});
	} catch (e) {}
});
