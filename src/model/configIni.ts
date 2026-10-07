// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026, Tiny Tapeout LTD

/**
 * Editing of the demo board's config.ini file, which the firmware reads on boot to pick the
 * default project and its settings. The edits are line-based so that comments and the sections
 * of other projects are preserved.
 *
 * The firmware's ini parser is minimal: section headers must be exactly `[name]` on their own
 * line, options are `key = value`, and lines starting with `#` are comments. Line endings must
 * be LF, so the output is always normalized.
 */

export type ProjectMode = 'ASIC_RP_CONTROL' | 'ASIC_MANUAL_INPUTS';

export interface DefaultProjectConfig {
  /** Shuttle name of the project, e.g. `tt_um_factory_test`. */
  macro: string;
  /** Project clock frequency in Hz; 0 disables auto-clocking. */
  clockHz: number;
  mode: ProjectMode;
  /** Value to drive on ui_in; omit when the RP2040 shouldn't drive the inputs. */
  uiIn?: number;
}

/** Used when the board has no config.ini (or it couldn't be read). */
export const configIniTemplate = `# Tiny Tapeout demo board user config file
# See https://github.com/TinyTapeout/tt-micropython-firmware for the available options.

[DEFAULT]
# project: project to load by default
project =
`;

const sectionHeader = /^\s*\[([^\]]*)\]\s*$/;

function optionPattern(key: string) {
  return new RegExp(`^\\s*${key}\\s*=`);
}

interface Section {
  name: string;
  /** Index of the header line. */
  start: number;
  /** Index one past the last line of the section. */
  end: number;
}

function findSections(lines: string[]) {
  const sections: Section[] = [];
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(sectionHeader);
    if (match) {
      if (sections.length) {
        sections[sections.length - 1].end = i;
      }
      sections.push({ name: match[1].trim(), start: i, end: lines.length });
    }
  }
  return sections;
}

function findSection(lines: string[], name: string) {
  return findSections(lines).find((section) => section.name === name);
}

/**
 * Sets (or removes, when `value` is null) an option within the given section, keeping the
 * other lines of the section intact. The section must exist.
 */
function setOption(lines: string[], sectionName: string, key: string, value: string | null) {
  const section = findSection(lines, sectionName)!;
  const pattern = optionPattern(key);
  const body = lines.slice(section.start + 1, section.end);
  const index = body.findIndex((line) => !line.trim().startsWith('#') && pattern.test(line));
  if (index >= 0) {
    if (value == null) {
      lines.splice(section.start + 1 + index, 1);
    } else {
      lines[section.start + 1 + index] = `${key} = ${value}`;
    }
  } else if (value != null) {
    // Insert after the last option of the section, so trailing blank lines stay at the end.
    let insertAt = section.start + 1;
    for (let i = 0; i < body.length; i++) {
      if (body[i].trim() !== '') {
        insertAt = section.start + 2 + i;
      }
    }
    lines.splice(insertAt, 0, `${key} = ${value}`);
  }
}

function ensureSection(lines: string[], name: string) {
  const section = findSection(lines, name);
  if (section) {
    // Normalize the header: the firmware only recognizes `[name]` without surrounding spaces.
    lines[section.start] = `[${name}]`;
    return;
  }
  while (lines.length && lines[lines.length - 1].trim() === '') {
    lines.pop();
  }
  if (lines.length) {
    lines.push('');
  }
  lines.push(`[${name}]`);
}

export function formatUiIn(value: number) {
  return `0b${(value & 0xff).toString(2).padStart(8, '0')}`;
}

/**
 * Returns a new config.ini content with the given project as the default project, and its
 * section updated to the given settings. Other sections and comments are preserved.
 *
 * @param existing current content of config.ini, or null if the board doesn't have one
 */
export function makeDefaultProject(existing: string | null, config: DefaultProjectConfig) {
  const lines = (existing || configIniTemplate).split(/\r?\n/);

  const sections = findSections(lines);
  if (!sections.some((section) => section.name === 'DEFAULT')) {
    lines.unshift('[DEFAULT]', '');
  }
  setOption(lines, 'DEFAULT', 'project', config.macro);

  ensureSection(lines, config.macro);
  setOption(
    lines,
    config.macro,
    'clock_frequency',
    config.clockHz > 0 ? `${config.clockHz}` : null,
  );
  setOption(lines, config.macro, 'mode', config.mode);
  setOption(lines, config.macro, 'ui_in', config.uiIn != null ? formatUiIn(config.uiIn) : null);

  while (lines.length && lines[lines.length - 1].trim() === '') {
    lines.pop();
  }
  return lines.join('\n') + '\n';
}
