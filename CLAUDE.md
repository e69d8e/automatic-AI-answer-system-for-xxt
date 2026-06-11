# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Tampermonkey userscript that automates answering quizzes/exams on the Chaoxing (学习通) online learning platform. Single-file IIFE architecture — no build system, no tests, no package manager, no CI/CD. The `.user.js` file is installed directly into Tampermonkey.

## Files

- `学习通AI答题.user.js` — the entire application (2049 lines)
- `DESIGN.md` — Anthropic design system reference used for UI color tokens

## How to Develop

Edit `学习通AI答题.user.js` directly. To test: install/update the file in Tampermonkey, then navigate to a Chaoxing quiz page (`*.chaoxing.com` or `*.edu.cn`). No build step required.

## Code Architecture

Everything is a single IIFE. Key modules (referenced by approximate line ranges):

| Module | Lines | Responsibility |
|---|---|---|
| `CONFIG` | 23–43 | Settings via `GM_getValue`/`GM_setValue` (API keys, provider, delay, auto-submit) |
| Style System | 63–350 | CSS injection via `GM_addStyle`, uses DESIGN.md color tokens (warm cream/coral palette) |
| `Logger` | 367–385 | `info`/`success`/`warn`/`error` → panel log + console |
| `FontDecryptor` | 410–491 | Defeats Chaoxing's `font-cxsecret` anti-scraping font obfuscation via Selection API |
| `DomParser` | 494–764 | Traverses DOM + nested iframes to extract questions, options, blanks, hidden answers |
| `AIClient` | 767–1001 | Builds per-type prompts, calls DeepSeek/MiMo APIs via `GM_xmlhttpRequest`, streaming + fallback |
| `AnswerFiller` | 1003–1363 | Parses AI response → structured answers, fills via UEditor/contenteditable/textarea/iframe fallbacks |
| `Controller` | 1367–1613 | Main loop: parse → AI → fill → delay; supports abort, skip-answered, start-from-N, auto-submit |
| `Panel` | 1616–1998 | Floating draggable UI (Control/Settings/Log tabs), settings persistence, diagnostic tool |
| `init()` | 2024–2047 | Waits for DOM, creates panel, auto-detects questions |

## Question Type Codes

0=single choice, 1=multiple choice, 2=true/false, 3=fill-in-the-blank, 4=short answer, 5=essay, 6=calculation, 7=Q&A

## AI Providers

Two supported via `CONFIG.provider`: DeepSeek (`api.deepseek.com`) and MiMo (`api.xiaomimimo.com`). Temperature is fixed at 0.1 for deterministic output. Streaming is attempted first, falls back to non-streaming on failure.

## Tampermonkey APIs Used

`GM_xmlhttpRequest` (cross-origin HTTP), `GM_setValue`/`GM_getValue` (persistent storage), `GM_addStyle` (CSS injection), `GM_registerMenuCommand` (menu entries)
