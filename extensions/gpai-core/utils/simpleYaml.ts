interface Frame {
  indent: number
  kind: 'object' | 'array'
  value: Record<string, unknown> | unknown[]
  parent?: Frame
  keyInParent?: string | number
  placeholder?: boolean
}

function stripInlineComment(line: string): string {
  let inSingle = false
  let inDouble = false
  let escaped = false

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]

    if (escaped) {
      escaped = false
      continue
    }

    if (ch === '\\') {
      escaped = true
      continue
    }

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle
      continue
    }

    if (ch === '"' && !inSingle) {
      inDouble = !inDouble
      continue
    }

    if (ch === '#' && !inSingle && !inDouble) {
      return line.slice(0, i).trimEnd()
    }
  }

  return line
}

function parseQuoted(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }
  return value
}

function splitTopLevelComma(value: string): string[] {
  const parts: string[] = []
  let current = ''
  let inSingle = false
  let inDouble = false
  let depth = 0

  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i]

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle
      current += ch
      continue
    }

    if (ch === '"' && !inSingle) {
      inDouble = !inDouble
      current += ch
      continue
    }

    if (!inSingle && !inDouble) {
      if (ch === '[' || ch === '{') {
        depth += 1
      } else if (ch === ']' || ch === '}') {
        depth = Math.max(0, depth - 1)
      } else if (ch === ',' && depth === 0) {
        parts.push(current.trim())
        current = ''
        continue
      }
    }

    current += ch
  }

  if (current.trim().length > 0) {
    parts.push(current.trim())
  }

  return parts
}

function parseScalar(value: string): unknown {
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return ''
  }

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return parseQuoted(trimmed)
  }

  if (trimmed === 'true') {
    return true
  }
  if (trimmed === 'false') {
    return false
  }
  if (trimmed === 'null' || trimmed === '~') {
    return null
  }

  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed)
  }

  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const body = trimmed.slice(1, -1).trim()
    if (!body) {
      return []
    }
    return splitTopLevelComma(body).map((part) => parseScalar(part))
  }

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    const body = trimmed.slice(1, -1).trim()
    if (!body) {
      return {}
    }

    const obj: Record<string, unknown> = {}
    splitTopLevelComma(body).forEach((part) => {
      const idx = part.indexOf(':')
      if (idx <= 0) {
        return
      }
      const key = part.slice(0, idx).trim()
      const rawValue = part.slice(idx + 1)
      obj[parseQuoted(key)] = parseScalar(rawValue)
    })
    return obj
  }

  return trimmed
}

function parseKeyValue(line: string): { key: string; value: string | null } | null {
  const idx = line.indexOf(':')
  if (idx <= 0) {
    return null
  }

  const key = line.slice(0, idx).trim()
  const rest = line.slice(idx + 1).trim()
  return {
    key,
    value: rest.length > 0 ? rest : null
  }
}

function ensureParentArray(frame: Frame): void {
  if (frame.kind === 'array') {
    return
  }

  if (
    frame.placeholder &&
    frame.parent &&
    typeof frame.keyInParent === 'string' &&
    frame.kind === 'object'
  ) {
    const arr: unknown[] = []
    ;(frame.parent.value as Record<string, unknown>)[frame.keyInParent] = arr
    frame.kind = 'array'
    frame.value = arr
    frame.placeholder = false
  }
}

export function parseSimpleYaml(content: string): Record<string, unknown> {
  const root: Frame = {
    indent: -1,
    kind: 'object',
    value: {}
  }

  const stack: Frame[] = [root]
  const lines = content.split('\n')

  for (const rawLine of lines) {
    const cleaned = stripInlineComment(rawLine)
    if (!cleaned.trim()) {
      continue
    }

    const indent = cleaned.length - cleaned.trimStart().length
    const trimmed = cleaned.trim()

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop()
    }

    const parent = stack[stack.length - 1]

    if (trimmed.startsWith('- ')) {
      ensureParentArray(parent)
      if (parent.kind !== 'array') {
        continue
      }

      const itemText = trimmed.slice(2).trim()
      const arr = parent.value as unknown[]

      if (!itemText) {
        const obj: Record<string, unknown> = {}
        arr.push(obj)
        stack.push({
          indent,
          kind: 'object',
          value: obj,
          parent,
          keyInParent: arr.length - 1,
          placeholder: true
        })
        continue
      }

      const inlineKv = parseKeyValue(itemText)
      if (inlineKv) {
        const obj: Record<string, unknown> = {}
        obj[inlineKv.key] = inlineKv.value === null ? {} : parseScalar(inlineKv.value)
        arr.push(obj)

        if (inlineKv.value === null) {
          stack.push({
            indent,
            kind: 'object',
            value: obj[inlineKv.key] as Record<string, unknown>,
            parent: {
              indent,
              kind: 'object',
              value: obj
            },
            keyInParent: inlineKv.key,
            placeholder: true
          })
        }
      } else {
        arr.push(parseScalar(itemText))
      }
      continue
    }

    const kv = parseKeyValue(trimmed)
    if (!kv) {
      continue
    }

    if (parent.kind !== 'object') {
      continue
    }

    const obj = parent.value as Record<string, unknown>
    if (kv.value === null) {
      obj[kv.key] = {}
      stack.push({
        indent,
        kind: 'object',
        value: obj[kv.key] as Record<string, unknown>,
        parent,
        keyInParent: kv.key,
        placeholder: true
      })
    } else {
      obj[kv.key] = parseScalar(kv.value)
    }
  }

  return root.value as Record<string, unknown>
}

