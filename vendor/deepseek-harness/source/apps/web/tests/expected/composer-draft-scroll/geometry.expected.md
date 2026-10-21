# Composer draft scrolling (14-line cap, one editable surface, one scrollport)

## At the start of the draft

- draft overflows the capped box: true
- visible lines: 14
- the surface holds no scroll offset of its own: true
- scroll offset: 0px
- first draft line is on screen: true
- last draft line is on screen: false

## Scrolled to the end of the draft

- offset moved: true
- the surface holds no scroll offset of its own: true
- first draft line has scrolled out above: true
- last draft line is on screen: true

## Draft ending in a newline, scrolled to the end

- the draft's own last line is on screen: true

## Right after pasting a long block at the end

- the composer scrolled to the caret it left: true
- the pasted block's last line is on screen: true
