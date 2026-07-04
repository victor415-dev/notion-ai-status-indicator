let ding = null;

chrome.runtime.onMessage.addListener((msg) => {
	if (!msg || msg.type !== "NAI_PLAY_SOUND") return;
	playDing();
});

async function playDing() {
	try {
		if (!ding) {
			ding = new Audio(chrome.runtime.getURL("assets/ding.mp3"));
			ding.preload = "auto";
		}
		ding.currentTime = 0;
		await ding.play();
	} catch (e) {
		/* ding.mp3 是可选素材，缺失或播放失败时静默跳过 */
	}
}
