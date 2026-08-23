import {
  MeetingPart,
  MeetingPartType,
  MeetingSection,
  MeetingWeek,
} from '../services/meeting-schedule.service';

/**
 * Shared view model for the printed schedule and the on-screen workbook
 * editor. Both renderings consume the same labels, colors, numbering, and
 * role-pair logic so the editor can never drift from the export.
 */

export type ScheduleLanguage = 'en' | 'ilo';

export interface ScheduleLabels {
  midweekTitle: string;
  weekendTitle: string;
  cleaner: string;
  chairman: string;
  prayer: string;
  song: string;
  andPrayer: string;
  openingComments: string;
  closingComments: string;
  sections: Record<MeetingSection, string>;
  student: string;
  assistant: string;
  preacher: string;
  householder: string;
  conductor: string;
  reader: string;
  publicTalk: string;
  watchtowerStudy: string;
  noMeeting: string;
  coVisit: string;
  memorial: string;
  months: string[];
}

export const LABELS: Record<ScheduleLanguage, ScheduleLabels> = {
  en: {
    midweekTitle: 'Midweek Meeting Schedule',
    weekendTitle: 'Weekend Meeting Schedule',
    cleaner: 'Cleaner of the week',
    chairman: 'Chairman:',
    prayer: 'Prayer:',
    song: 'Song',
    andPrayer: 'and Prayer',
    openingComments: 'Opening Comments (1 min.)',
    closingComments: 'Concluding Comments (3 min.)',
    sections: {
      treasures: "TREASURES FROM GOD'S WORD",
      ministry: 'APPLY YOURSELF TO THE FIELD MINISTRY',
      living: 'LIVING AS CHRISTIANS',
    },
    student: 'Student:',
    assistant: 'Assistant:',
    preacher: 'Preacher:',
    householder: 'House Holder:',
    conductor: 'Conductor:',
    reader: 'Reader:',
    publicTalk: 'PUBLIC TALK',
    watchtowerStudy: 'WATCHTOWER STUDY',
    noMeeting: 'No meeting this week',
    coVisit: 'Circuit overseer visit',
    memorial: 'Memorial week',
    months: [
      'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
      'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER',
    ],
  },
  ilo: {
    midweekTitle: 'Eskediul ti Gimong iti Tengnga ti Lawas',
    weekendTitle: 'Eskediul ti Gimong iti Ngudo ti Lawas',
    cleaner: 'Cleaner of the week',
    chairman: 'Tserman:',
    prayer: 'Kararag:',
    song: 'Kanta',
    andPrayer: 'ken Kararag',
    openingComments: 'Panglukat a Sasao (1 min.)',
    closingComments: 'Pangserra a Sasao (3 min.)',
    sections: {
      treasures: 'GAMENG MANIPUD ITI SAO TI DIOS',
      ministry: 'AGBALIN A MAS EPEKTIBO ITI MINISTERIO',
      living: 'PANAGBIAG KAS KRISTIANO',
    },
    student: 'Estudiante:',
    assistant: 'Katulonganna:',
    preacher: 'Preacher:',
    householder: 'House Holder:',
    conductor: 'Konduktor:',
    reader: 'Parabasa:',
    publicTalk: 'PALAWAG PUBLIKO',
    watchtowerStudy: 'PANAGADAL ITI PAGWANAWANAN',
    noMeeting: 'Awan ti gimong iti daytoy a lawas',
    coVisit: 'Panagsarungkar ti manangaywan iti sirkito',
    memorial: 'Memorial',
    months: [
      'ENERO', 'PEBRERO', 'MARSO', 'ABRIL', 'MAYO', 'HUNIO',
      'HULIO', 'AGOSTO', 'SEPTIEMBRE', 'OKTUBRE', 'NOBIEMBRE', 'DISIEMBRE',
    ],
  },
};

export const SECTION_COLORS: Record<MeetingSection, string> = {
  treasures: '#57646e',
  ministry: '#bf8f00',
  living: '#953734',
};

/** "AGOSTO 10 – 16" style range for the workbook week (Monday to Sunday). */
export function weekRange(weekOfIso: string, labels: ScheduleLabels): string {
  const start = new Date(`${weekOfIso}T00:00:00`);
  if (Number.isNaN(start.getTime())) return weekOfIso;
  const end = new Date(start);
  end.setDate(end.getDate() + 6);

  const startMonth = labels.months[start.getMonth()];
  const endMonth = labels.months[end.getMonth()];
  if (start.getMonth() === end.getMonth()) {
    return `${startMonth} ${start.getDate()} – ${end.getDate()}`;
  }
  return `${startMonth} ${start.getDate()} – ${endMonth} ${end.getDate()}`;
}

export interface NumberedPartRow {
  part: MeetingPart;
  num: number;
}

export interface MidweekSectionVM {
  section: MeetingSection;
  color: string;
  heading: string;
  rows: NumberedPartRow[];
}

/**
 * Midweek program sections in workbook order with continuous part numbering
 * across sections. The CBS reader merges into the CBS row's assignment cell,
 * so it never gets its own number; empty sections are omitted.
 */
export function buildMidweekSections(week: MeetingWeek, labels: ScheduleLabels): MidweekSectionVM[] {
  let num = 0;
  const sections: MidweekSectionVM[] = [];
  for (const section of ['treasures', 'ministry', 'living'] as MeetingSection[]) {
    const parts = week.parts.filter(
      (p) => p.section === section && p.part_type !== 'cbs_reader'
    );
    if (parts.length === 0) continue;
    sections.push({
      section,
      color: SECTION_COLORS[section],
      heading: labels.sections[section],
      rows: parts.map((part) => ({ part, num: ++num })),
    });
  }
  return sections;
}

export interface AssignmentRolePair {
  primary: string;
  secondary: string;
}

/**
 * Role labels for a part's assignment cell, or null for plain single-name
 * parts. The CBS pair's secondary name lives on the separate cbs_reader part.
 */
export function assignmentRolePair(
  partType: MeetingPartType,
  labels: ScheduleLabels
): AssignmentRolePair | null {
  if (partType === 'bible_reading' || partType === 'student_talk') {
    return { primary: labels.student, secondary: labels.assistant };
  }
  if (partType === 'student_demo') {
    return { primary: labels.preacher, secondary: labels.householder };
  }
  if (partType === 'cbs') {
    return { primary: labels.conductor, secondary: labels.reader };
  }
  return null;
}
