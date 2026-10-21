# Markdown wide-table relations

| viewport | table | fills the column | scrolls | breaks out past the column |
| --- | --- | --- | --- | --- |
| 1680px | fill | true | false | false |
| 1680px | wide | false | true | true |
| 1680px | long-cell | true | false | false |
| 1100px | fill | true | false | false |
| 1100px | wide | false | true | true |
| 1100px | long-cell | true | false | false |
| 640px | fill | true | false | false |
| 640px | wide | false | true | false |
| 640px | long-cell | true | false | false |

Wrap-first engagement (taller at the narrowest stop than at the widest):

- fill: true
- long-cell: true
