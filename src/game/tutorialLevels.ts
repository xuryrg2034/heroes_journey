/**
 * The 16 authored battles of the opening path. Data lives in src/game/lessons/*,
 * the lesson format and builders in lessonBuilder.ts.
 */
import type { TutorialLesson } from './lessonBuilder';
import { OPENING_LESSONS } from './lessons/opening';
import { EDGE_LESSONS } from './lessons/edge';
import { FINALE_LESSONS } from './lessons/finale';

export * from './lessonBuilder';

export const TUTORIAL_LESSONS: TutorialLesson[] = [...OPENING_LESSONS, ...EDGE_LESSONS, ...FINALE_LESSONS];
