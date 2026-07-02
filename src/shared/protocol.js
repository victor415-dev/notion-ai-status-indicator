// 状态协议：content ↔ background 的唯一契约。
// 换宠物皮肤/动画不应改动这里（先把协议定死，见 README）。

export const STATES = Object.freeze({
	IDLE: "idle",
	THINKING: "thinking",
	RESPONDING: "responding",
	DONE: "done",
});

export const MSG = Object.freeze({
	STATE: "NAI_STATE", // content -> background：状态变更
	PLAY_SOUND: "NAI_PLAY_SOUND", // background -> offscreen：播放提示音
});

export const ALL_STATES = Object.values(STATES);
