import {
  EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, dropCursor,
  highlightSpecialChars, ViewPlugin, Decoration, type DecorationSet, type ViewUpdate,
} from '@codemirror/view'
import { EditorState, RangeSetBuilder } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { javascript, javascriptLanguage } from '@codemirror/lang-javascript'
import { syntaxHighlighting, HighlightStyle, bracketMatching, indentOnInput, syntaxTree } from '@codemirror/language'
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, snippetCompletion, type Completion } from '@codemirror/autocomplete'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { setDiagnostics, lintGutter, type Diagnostic } from '@codemirror/lint'
import { tags as t } from '@lezer/highlight'

const theme = EditorView.theme({
  '&': { height: '100%', color: '#e6e9f2', backgroundColor: 'transparent', fontSize: '13px' },
  '.cm-scroller': { fontFamily: '"SF Mono", "JetBrains Mono", ui-monospace, Menlo, Consolas, monospace', lineHeight: '1.65' },
  '.cm-content': { caretColor: '#8fc2ff', padding: '14px 0' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#8fc2ff', borderLeftWidth: '2px' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: 'rgba(76,157,255,0.28)' },
  '.cm-gutters': { backgroundColor: 'transparent', color: '#454c5e', border: 'none', paddingLeft: '6px' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: '#9aa3b5' },
  '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.028)' },
  '.cm-selectionMatch': { backgroundColor: 'rgba(255,255,255,0.07)' },
  '.cm-matchingBracket, .cm-nonmatchingBracket': { backgroundColor: 'rgba(143,194,255,0.18)', outline: 'none' },
  '.cm-tooltip': { backgroundColor: '#161a26', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', overflow: 'hidden' },
  '.cm-tooltip-autocomplete > ul > li': { padding: '4px 10px' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'rgba(76,157,255,0.3)', color: '#fff' },
  '.cm-completionDetail': { color: '#8a93a8', fontStyle: 'normal', marginLeft: '10px' },
  '.cm-diagnostic': { padding: '6px 10px' },
  '.cm-diagnostic-error': { borderLeft: '3px solid #ff5d6c' },
  '.cm-diagnostic-warning': { borderLeft: '3px solid #ffb547' },
  '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy #ff5d6c 1px', textUnderlineOffset: '3px' },
  '.cm-lintRange-warning': { backgroundImage: 'none', textDecoration: 'underline wavy #ffb547 1px', textUnderlineOffset: '3px' },
  '.cm-gutter-lint': { width: '14px' },
  '.cm-panels': { backgroundColor: '#11141d', color: '#e6e9f2' },
  '.cm-searchMatch': { backgroundColor: 'rgba(255,200,80,0.25)' },
  '.cm-pnote': { color: '#ffd37e' },
  '.cm-pbar': { color: '#5a6278' },
  '.cm-pdyn': { color: '#ff8fbf', fontStyle: 'italic' },
  '.cm-pped': { color: '#6fd6ff' },
  '.cm-pnote span, .cm-pbar span, .cm-pdyn span, .cm-pped span': { color: 'inherit !important' },
}, { dark: true })

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.definitionKeyword, t.moduleKeyword], color: '#c39bff' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#7cc4ff' },
  { tag: [t.string, t.special(t.string)], color: '#9fdcae' },
  { tag: [t.number, t.bool, t.null], color: '#ffb86b' },
  { tag: t.comment, color: '#5d6680', fontStyle: 'italic' },
  { tag: t.propertyName, color: '#9cd8ff' },
  { tag: [t.operator, t.punctuation, t.bracket, t.separator], color: '#8a93a8' },
  { tag: t.variableName, color: '#e6e9f2' },
  { tag: t.definition(t.variableName), color: '#f0f3fa' },
])

// Colours note names, bar lines, dynamics and pedal marks inside string literals.
const NOTATION = /(?<![\w#])([A-Ga-g](?:##|#|bb|b)?-?\d(?:\/[\d.t]+)?[~'>&]*(?:@\d+)?)|(\|+)|\b(ppp|pp|p|mp|mf|f|ff|fff|cresc|dim)\b|\b(ped)\b|(\*)/g
const marks = {
  note: Decoration.mark({ class: 'cm-pnote' }),
  bar: Decoration.mark({ class: 'cm-pbar' }),
  dyn: Decoration.mark({ class: 'cm-pdyn' }),
  ped: Decoration.mark({ class: 'cm-pped' }),
}
const notation = ViewPlugin.fromClass(class {
  decorations: DecorationSet
  constructor(view: EditorView) { this.decorations = this.build(view) }
  update(u: ViewUpdate) { if (u.docChanged || u.viewportChanged) this.decorations = this.build(u.view) }
  build(view: EditorView): DecorationSet {
    const b = new RangeSetBuilder<Decoration>()
    const tree = syntaxTree(view.state)
    for (const { from, to } of view.visibleRanges) {
      tree.iterate({
        from, to,
        enter: node => {
          if (node.name !== 'String' && node.name !== 'TemplateString') return
          const text = view.state.doc.sliceString(node.from, node.to)
          NOTATION.lastIndex = 0
          for (let m; (m = NOTATION.exec(text));) {
            const deco = m[1] ? marks.note : m[2] ? marks.bar : m[3] ? marks.dyn : marks.ped
            b.add(node.from + m.index, node.from + m.index + m[0].length, deco)
          }
          return false
        },
      })
    }
    return b.finish()
  }
}, { decorations: v => v.decorations })

const fn = (label: string, snippet: string, detail: string): Completion => snippetCompletion(snippet, { label, detail, type: 'function' })
const completions: Completion[] = [
  fn('title', 'title("${Titel}")', 'Titel des Stücks'),
  fn('composer', 'composer("${Name}")', 'Komponist'),
  fn('tempo', 'tempo(${90})', 'Viertel pro Minute'),
  fn('meter', 'meter(${3}, ${4})', 'Taktart'),
  fn('pickup', 'pickup("${/8}")', 'Auftakt'),
  fn('humanize', 'humanize(${0.6})', 'menschliches Timing'),
  fn('voice', 'voice("${Rechte Hand}")', 'neue Stimme'),
  fn('sync', 'sync()', 'Stimmen angleichen'),
  fn('bar', 'bar(${1})', 'Position von Takt n'),
  fn('transpose', 'transpose(${noten}, ${12})', 'Halbtöne verschieben'),
  fn('play', 'play(`${}`)', 'Notentext anhängen'),
  fn('note', 'note("${C4}", "${/4}")', 'einzelne Note'),
  fn('chord', 'chord([${"C4", "E4", "G4"}], "${/2}")', 'Akkord'),
  fn('rest', 'rest("${/4}")', 'Pause'),
  fn('at', 'at(${0})', 'Position setzen'),
]

export interface EditorApi {
  view: EditorView
  getCode(): string
  setCode(code: string): void
  showProblems(problems: { message: string; line?: number; severity: 'error' | 'warning' }[]): void
  goToLine(line: number): void
}

export function createEditor(parent: HTMLElement, doc: string, onChange: (code: string) => void, onRun: () => void): EditorApi {
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        lineNumbers(), highlightActiveLineGutter(), highlightSpecialChars(), history(), drawSelection(), dropCursor(),
        EditorState.allowMultipleSelections.of(true), indentOnInput(), bracketMatching(), closeBrackets(),
        autocompletion({ icons: false }), highlightActiveLine(), highlightSelectionMatches(), lintGutter(),
        javascript(), javascriptLanguage.data.of({ autocomplete: completions }),
        syntaxHighlighting(highlight), notation, theme, EditorView.lineWrapping,
        keymap.of([
          { key: 'Mod-Enter', run: () => { onRun(); return true } },
          ...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...completionKeymap, indentWithTab,
        ]),
        EditorView.updateListener.of(u => { if (u.docChanged) onChange(u.state.doc.toString()) }),
      ],
    }),
  })
  return {
    view,
    getCode: () => view.state.doc.toString(),
    setCode(code) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: code }, selection: { anchor: 0 }, scrollIntoView: true })
    },
    showProblems(problems) {
      const doc = view.state.doc
      const diags: Diagnostic[] = []
      for (const p of problems) {
        if (!p.line || p.line < 1 || p.line > doc.lines) continue
        const line = doc.line(p.line)
        const from = line.from + (line.text.length - line.text.trimStart().length)
        diags.push({ from, to: Math.max(from, line.to), severity: p.severity, message: p.message })
      }
      view.dispatch(setDiagnostics(view.state, diags))
    },
    goToLine(n) {
      const doc = view.state.doc
      const line = doc.line(Math.max(1, Math.min(n, doc.lines)))
      view.dispatch({ selection: { anchor: line.from, head: line.to }, scrollIntoView: true })
      view.focus()
    },
  }
}
