export type Author = 'human' | 'ai';

export interface Anchor {
  /** Anchor tag's byte offset in the source. */
  byteOffset: number;
  /** 1-indexed line range, inclusive. */
  lineRange: [number, number];
  /** Best-effort text the annotation anchors to (the span preceding the tag). */
  text: string;
}

export interface CommentMessage {
  by: Author;
  time: string;
  body: string;
}

export type AnnotationStatus = 'open' | 'resolved';

export interface Annotation {
  kind: 'annotation';
  id: string;
  status: AnnotationStatus;
  anchor: Anchor;
  comments: CommentMessage[];
  /** Source byte range of all tags belonging to this annotation (ann + comments). */
  sourceRange: [number, number];
}

export interface Suggestion {
  kind: 'suggestion';
  id: string;
  by: Author;
  anchor: Anchor;
  old: string;
  new: string;
  /** Source byte range of this suggestion's tag. */
  sourceRange: [number, number];
}

export type Item = Annotation | Suggestion;
