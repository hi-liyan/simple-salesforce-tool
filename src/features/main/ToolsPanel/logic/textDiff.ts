// 判断当前文本对比页签是否仍为空：左右两侧都没有可见内容时返回 true。
export function isTextDiffInputEmpty(leftText: string, rightText: string): boolean {
  return leftText.trim().length === 0 && rightText.trim().length === 0;
}
