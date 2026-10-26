const enum State {
  DELIM,
  UPPER,
  LOWER,
}

function tokenize(source: string, delimiters: number[], delimiter: number) {
  const output: number[] = []
  let state = State.DELIM
  for (let i = 0; i < source.length; i++) {
    const code = source.charCodeAt(i)
    if (code >= 65 && code <= 90) {
      if (state === State.UPPER) {
        const next = source.charCodeAt(i + 1)
        if (next >= 97 && next <= 122) {
          output.push(delimiter)
        }
        output.push(code + 32)
      } else {
        if (state !== State.DELIM) {
          output.push(delimiter)
        }
        output.push(code + 32)
      }
      state = State.UPPER
    } else if (code >= 97 && code <= 122) {
      output.push(code)
      state = State.LOWER
    } else if (delimiters.includes(code)) {
      if (state !== State.DELIM) {
        output.push(delimiter)
      }
      state = State.DELIM
    } else {
      output.push(code)
    }
  }
  return String.fromCharCode(...output)
}

/** Convert text to dash-delimited parameter case. */
export function hyphenate(source: string) {
  return tokenize(source, [45, 95], 45)
}
