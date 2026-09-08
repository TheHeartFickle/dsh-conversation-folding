// ---------- §10 静态样式 ----------
// 由 apply() 注入 <style data-plugin-css="dsh-conversation-folding/styles">；
// 动态隐藏规则不在其中，见 projection.js 的 styleText + views.js 的
// FoldStyleMount（动态样式须位于静态样式之后，同优先级后者胜出）。
export const CSS = [
	".dsh-think{flex-direction:column;display:flex}",
	".dsh-think-row{position:relative;overflow:hidden}",
	".dsh-think-leading{flex-shrink:0}",
	".dsh-think-chevron{color:var(--dsw-alias-label-secondary)}",
	".dsh-think-title{font-weight:400}",
	".dsh-think-separator{background:var(--dsw-alias-label-caption);border-radius:1px;flex:none;width:2px;height:2px;margin:0 0.5rem}",
	".dsh-think-summary{min-width:0;color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;flex:auto;font-size:0.875rem;line-height:1.5rem;overflow:hidden}",
	".dsh-think-body{box-sizing:border-box;background:var(--dsw-alias-markdown-code-block);width:calc(100% - 1.375rem);max-height:12rem;color:var(--dsw-alias-label-tertiary);white-space:pre-wrap;word-break:break-word;border:none;border-radius:0.5rem;margin:0.25rem 0 0 1.375rem;padding:0.625rem 1rem 0.75rem 0.75rem;overflow-y:auto;overscroll-behavior:contain;font-size:0.875rem;line-height:1.5rem}",
	".dsh-assistant-root{color:var(--dsw-alias-label-primary);flex-direction:column;font-size:1rem;line-height:1.75rem;display:flex}",
	".dsh-assistant-body{flex-direction:column;gap:1rem;display:flex}",
	".dsh-assistant-stopped{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-tertiary);border-radius:0.375rem;align-self:flex-start;padding:0 0.375rem;font-size:0.6875rem;line-height:1.125rem}",
	"[data-dsh-hidden-turn]{display:none}",
	'[data-chat-flow-kind="assistant-step"]:has([data-dsh-hidden-turn]){display:none}',
	".dsh-tv-row{border-bottom:.5px solid var(--dsw-alias-border-l2);align-items:center;gap:8px;padding:16px 0;display:flex}",
	".dsh-tv-rowText{flex-direction:column;flex:1;gap:4px;min-width:0;padding-right:48px;display:flex}",
	".dsh-tv-title{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:400;line-height:22px}",
	".dsh-tv-desc{color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:400;line-height:18px}",
	".dsh-tv-selector{background:var(--dsw-alias-bg-module-platform);height:36px;font:inherit;color:var(--dsw-alias-label-primary);cursor:pointer;border:none;border-radius:18px;align-items:center;gap:12px;padding:0 14px;font-size:14px;line-height:22px;display:inline-flex}",
	".dsh-tv-selector:hover{background:var(--dsw-alias-interactive-bg-hover)}",
	".dsh-tv-chevron{flex:none}",
	".dsh-tv-select{background:var(--dsw-alias-bg-module-platform);height:36px;color:var(--dsw-alias-label-primary);cursor:pointer;border:none;border-radius:18px;align-items:center;gap:12px;padding:0 14px;font-size:14px;line-height:22px;display:inline-flex}",
	// 「对话折叠」设置页（settings.section 独立标签页）
	".dsh-fs-page{width:100%}",
	".dsh-fs-head{border-bottom:.5px solid var(--dsw-alias-border-l2);padding:16px 0}",
	".dsh-fs-title{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:400;line-height:22px}",
	".dsh-fs-desc{color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:400;line-height:18px;margin-top:4px}",
	".dsh-fs-row{border-bottom:.5px solid var(--dsw-alias-border-l2);align-items:center;gap:8px;padding:12px 0;display:flex}",
	".dsh-fs-rowText{flex-direction:column;flex:1;min-width:0;display:flex}",
	".dsh-fs-rowText .dsh-fs-desc{margin-top:2px}",
	".dsh-fs-switch{background:var(--dsw-alias-bg-module-platform);border:1px solid var(--dsw-alias-border-l2);border-radius:999px;width:36px;height:20px;padding:0;position:relative;cursor:pointer;flex:none;transition:background .1s}",
	".dsh-fs-switch:hover{border-color:var(--dsw-alias-label-tertiary)}",
	".dsh-fs-switch[data-on]{background:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-primary)}",
	".dsh-fs-knob{background:var(--dsw-alias-label-tertiary);border-radius:999px;width:14px;height:14px;position:absolute;left:2px;top:2px;transition:transform .1s,background .1s}",
	".dsh-fs-switch[data-on] .dsh-fs-knob{background:var(--dsw-alias-bg-module-platform);transform:translateX(16px)}",
	".dsh-turnfold{box-sizing:border-box;border:none;border-bottom:.5px solid var(--dsw-alias-border-l2);width:100%;min-width:0;height:33px;color:var(--dsw-alias-label-secondary);cursor:pointer;text-align:left;background:0 0;align-items:center;padding:0 0 8px;display:flex}",
	".dsh-turnfold[data-open]{padding:8px 0 8px}",
	".dsh-turnfold-label{text-overflow:ellipsis;white-space:nowrap;min-width:0;font-size:14px;line-height:24px;overflow:hidden}",
	".dsh-turnfold-chevron{width:16px;height:16px;color:var(--dsw-alias-label-tertiary);flex:none;margin-left:6px;transition:transform .1s;transform:rotate(-90deg)}",
	".dsh-turnfold[data-open] .dsh-turnfold-chevron{transform:rotate(0)}",
	// B2 栏锚定进座位后的间距：before 栏补上原先流程条目间距的下空隙，
	// after 栏与上方正文拉开距离（兜底栏仍在独立条目内，不受影响）。
	'[data-chat-flow-kind="assistant-step"] .dsh-turnfold[data-bar-pos="before"]{margin:0 0 8px}',
	'[data-chat-flow-kind="assistant-step"] .dsh-turnfold[data-bar-pos="after"]{margin:12px 0 0}',
	// 折叠显示模式：折叠由插件接管。抵消官方 compact 视图对过程座位的隐藏
	//（hidden="until-found" 走 content-visibility:hidden，需一并还原；
	// 带插件隐藏标记的 assistant-step / turn-process 座位仍由上方 :has 规则隐藏）。
	':root[data-dsh-fold-mode=all] [data-chat-flow-key][hidden]:not(:has([data-dsh-hidden-turn])){display:block!important;content-visibility:visible!important}'
].join("");
