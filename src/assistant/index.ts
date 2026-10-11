// Public surface of the assistant feature: other features import only from here.
export { assistant, type AssistantApp } from './entry-points/dependencies';
export type { Tool } from './entry-points/tools/tool';
export { previewAnswer } from './entry-points/http/preview-answer';
export { runAction } from './entry-points/http/run-action';
export { postMessage } from './entry-points/http/post-message';
export { sendMessage, answerWithEvidence, runTool, toolDefinitions } from './entry-points/legacy';
