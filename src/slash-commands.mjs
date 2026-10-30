export const commands = [
  { id: 'h1', label: 'heading1', aliases: 'heading title 제목 heading1', text: '# ' },
  { id: 'h2', label: 'heading2', aliases: 'heading title 제목 heading2', text: '## ' },
  { id: 'h3', label: 'heading3', aliases: 'heading title 제목 heading3', text: '### ' },
  { id: 'bullet', label: 'bulletList', aliases: 'list unordered ul 목록', text: '- ' },
  { id: 'number', label: 'numberedList', aliases: 'list ordered ol 번호 목록', text: '1. ' },
  { id: 'task', label: 'taskList', aliases: 'todo check checklist 할일 체크리스트', text: '- [ ] ' },
  { id: 'quote', label: 'blockquote', aliases: 'blockquote 인용', text: '> ' },
  { id: 'code', label: 'codeBlock', aliases: 'fence 코드', text: '```\n\n```', caret: 4 },
  { id: 'mermaid', label: 'mermaidBlock', aliases: 'diagram graph 다이어그램 그래프', text: '```mermaid\nflowchart LR\n    A --> B\n```', caret: 26 },
  { id: 'table', label: 'table', aliases: '표', text: '| A | B |\n| --- | --- |\n|  |  |', caret: 26 },
  { id: 'link', label: 'link', aliases: 'url 링크', text: '[](https://)', caret: 1 },
  { id: 'image', label: 'image', aliases: 'picture photo 이미지 사진', text: '![](image.png)', caret: 2 },
  { id: 'bold', label: 'bold', aliases: 'strong 굵게', text: '****', caret: 2 },
  { id: 'italic', label: 'italic', aliases: 'em emphasis 기울임', text: '**', caret: 1 },
  { id: 'divider', label: 'divider', aliases: 'hr horizontal 구분선', text: '---\n' }
];

export function slashMatch(value, caret) {
  const match = value.slice(0, caret).match(/(?:^|\s)\/([^\s/]*)$/u);
  return match ? { start: caret - match[1].length - 1, query: match[1].toLowerCase() } : null;
}
export function matchingCommands(query, label) {
  return commands.filter(command => `${command.id} ${command.aliases} ${label(command.label)}`.toLowerCase().includes(query));
}
