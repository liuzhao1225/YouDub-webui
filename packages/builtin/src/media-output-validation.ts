import type { Context } from 'cordis'
import { AppError, type JsonObject, type OutputValidator } from '@youdub/sdk'

const fail = (message: string): never => { throw new AppError('INVALID_PROVIDER_RESULT', message, 500) }
const unique = (ids: string[]) => new Set(ids).size === ids.length
const sameIds = (actual: string[], expected: string[]) => unique(actual) && actual.length === expected.length && actual.every(id => expected.includes(id))
const transcriptOf = ({ inputs, outputs }: { inputs: JsonObject; outputs: JsonObject }) => inputs.transcript ?? outputs.transcript

/** These checks mirror the public media invariants in Python segments/audio_segments. */
export const mediaOutputValidators: Record<string, OutputValidator> = {
  'transcript/v1': value => {
    if (!unique(value.segments.map((segment: JsonObject) => segment.id))) fail('Transcript segment IDs must be unique.')
    for (const segment of value.segments) {
      if (segment.end_ms <= segment.start_ms) fail(`Segment ${segment.id} end must follow its start.`)
      if (segment.words != null) {
        let previousEnd = segment.start_ms
        for (const word of segment.words) {
          if (word.end_ms < word.start_ms || word.start_ms < previousEnd || word.end_ms > segment.end_ms) fail(`Word timestamps must be monotonic inside segment ${segment.id}.`)
          previousEnd = word.end_ms
        }
        if (!segment.words.length || segment.words.map((word: JsonObject) => word.text).join('').trim() !== segment.text.trim()) fail(`Word text must reproduce segment ${segment.id}.`)
      }
    }
  },
  'translation/v1': (value, context) => {
    const ids = value.segments.map((segment: JsonObject) => segment.segment_id), transcript = transcriptOf(context)
    if (!unique(ids)) fail('Translation segment IDs must be unique.')
    if (transcript && (!sameIds(ids, transcript.segments.map((segment: JsonObject) => segment.id)) || value.source_language !== transcript.detected_language)) fail('Translation must match the original segments and source language.')
  },
  'speech-audio/v1': (value, context) => {
    const ids = value.segments.map((segment: JsonObject) => segment.id), transcript = transcriptOf(context)
    if (!unique(ids) || transcript && !sameIds(ids, transcript.segments.map((segment: JsonObject) => segment.id))) fail('Speech audio must contain each original segment exactly once.')
  },
  'voice-references/v1': (value, context) => {
    const ids = value.map((reference: JsonObject) => reference.segmentId), transcript = transcriptOf(context)
    if (!unique(ids) || transcript && !sameIds(ids, transcript.segments.map((segment: JsonObject) => segment.id))) fail('Voice references must contain each original segment exactly once.')
  },
  'word-alignment/v1': (value, context) => {
    const duration = context.inputs.mediaInfo?.duration_ms
    let previousEnd = 0
    for (const cue of value) {
      if (cue.start_ms < previousEnd || cue.end_ms <= cue.start_ms || duration !== undefined && cue.end_ms > duration) fail('Aligned subtitle cues must be ordered and inside the source video.')
      previousEnd = cue.end_ms
    }
    const translation = context.inputs.translation, transcript = transcriptOf(context)
    if (translation) {
      const texts = new Map<string, string>(translation.segments.map((segment: JsonObject) => [segment.segment_id, segment.text]))
      const expected = transcript ? transcript.segments.map((segment: JsonObject) => texts.get(segment.id)).join('') : translation.segments.map((segment: JsonObject) => segment.text).join('')
      if (value.map((cue: JsonObject) => cue.text).join('').replace(/\s/gu, '') !== expected.replace(/\s/gu, '')) fail('Aligned subtitle cues must preserve the complete translation.')
    }
  },
  'dubbed-timeline/v1': (value, context) => {
    const transcript = transcriptOf(context), duration = context.inputs.mediaInfo?.duration_ms
    if (!unique(value.segments.map((segment: JsonObject) => segment.segment_id))) fail('Dubbed timeline segment IDs must be unique.')
    if (transcript && value.segments.length !== transcript.segments.length) fail('Dubbed timeline must match the original segments.')
    let previousEnd = 0
    for (const [index, segment] of value.segments.entries()) {
      if (segment.source_end_ms <= segment.source_start_ms || segment.dubbed_end_ms <= segment.dubbed_start_ms) fail('Source and dubbed intervals must have positive duration.')
      const source = transcript?.segments[index]
      if (source && (segment.segment_id !== source.id || segment.source_start_ms !== source.start_ms || segment.source_end_ms !== source.end_ms)) fail('Dubbed timeline must preserve original segment order and timestamps.')
      if (segment.dubbed_start_ms < previousEnd || duration !== undefined && (segment.source_end_ms > duration || segment.dubbed_end_ms > duration)) fail('Dubbed segments must fit the video without overlap.')
      previousEnd = segment.dubbed_end_ms
    }
  },
}
export const name = 'media-output-validation'
export const inject = ['catalog']
export function apply(ctx: Context) {
  for (const [schemaId, validate] of Object.entries(mediaOutputValidators)) ctx.effect(() => ctx.catalog.registerOutputValidator(schemaId, validate))
}
