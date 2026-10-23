// Verbatim rules from youdub-backend/youdub/translator_v2.py:375-378.
export const CHINESE_SUBTITLE_PUNCTUATION_RULES = [
  '   - 使用中文标点（，。！？；：“”『』（）；破折号(——)被**禁止**，改用括号或逗号分句；省略号用…）。  ',
  '   - 冒号后如接列表或解释，按中文习惯断句；引号统一用“”，保持全文风格一致。',
  '   - 对于长句，使用逗号进行更详细的分句。',
  '   - 必须使用标点。',
].join('\n')
