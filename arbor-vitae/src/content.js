// All copy shown on the site. Station content is verbatim from the workshop brief.

// Paste the registration form URL here. Until it is a real http(s) link,
// the register button reads "registration opens soon" and is disabled.
export const REGISTER_URL = '[PASTE LINK]';

export const EVENT = {
  title: 'WHERE NEUROLOGY MEETS ENT',
  date: 'Saturday 5 December 2026',
  venue: 'College of Medicine, PNU',
  hosts: 'NSIG x ENTIG / PNU',
};

const symptom = (neuro, ent, practise) => [
  { name: 'neurology', tone: 'rose', items: neuro },
  { name: 'ENT', tone: 'gold', items: ent },
  { name: "you'll practise", tone: 'ivory', items: practise },
];

export const STATIONS = {
  vertigo: {
    kicker: 'symptom 01 / 06',
    groups: symptom(
      ['cerebellar stroke', 'vestibular migraine', 'multiple sclerosis', 'brainstem lesions'],
      ['BPPV', 'vestibular neuritis', 'Ménière disease', 'labyrinthitis'],
      ['HINTS exam', 'Dix-Hallpike maneuver', 'nystagmus assessment', 'red flags for central vertigo'],
    ),
  },
  hearing: {
    kicker: 'symptom 02 / 06',
    groups: symptom(
      ['vestibular schwannoma', 'brainstem lesions', 'multiple sclerosis', 'stroke'],
      ['otitis media', 'cholesteatoma', 'presbycusis', 'noise-induced hearing loss'],
      ['Weber and Rinne tests', 'cranial nerve exam', 'localization of lesions'],
    ),
  },
  facial: {
    kicker: 'symptom 03 / 06',
    groups: symptom(
      ['stroke', 'multiple sclerosis', 'brainstem lesions'],
      ['Bell palsy', 'Ramsay Hunt syndrome', 'parotid pathology'],
      ['UMN vs LMN facial weakness', 'facial nerve examination'],
    ),
  },
  tinnitus: {
    kicker: 'symptom 04 / 06',
    groups: symptom(
      ['vestibular schwannoma', 'intracranial pathology', 'vascular abnormalities'],
      ['Ménière disease', 'otosclerosis', 'noise-induced hearing loss'],
      ['focused tinnitus history', 'red flags requiring imaging'],
    ),
  },
  headache: {
    kicker: 'symptom 05 / 06',
    groups: symptom(
      ['migraine', 'cluster headache', 'intracranial pathology'],
      ['acute sinusitis', 'chronic rhinosinusitis', 'contact point headache'],
      ['headache history', 'recognizing secondary headache red flags'],
    ),
  },
  taste: {
    kicker: 'symptom 06 / 06',
    groups: symptom(
      ['Parkinson disease', 'temporal lobe lesions', 'neurodegenerative disorders'],
      ['chronic rhinosinusitis', 'nasal polyps', 'post-viral anosmia'],
      ['olfactory history', 'cranial nerve assessment'],
    ),
  },
  speakers: {
    kicker: 'the people',
    groups: [
      { name: 'Dr. Raseel Aljthalin', tone: 'rose', items: ['presenter', 'Board in Adult Neurology'] },
      { name: 'Dr. Nouf Alammari', tone: 'gold', items: ['presenter', 'ENT Resident'] },
      { name: 'supervised by', tone: 'ivory', items: ['Dr. Noura Alharbi · Neurology', 'Dr. Nuha Alrayes · ENT'] },
    ],
  },
  about: {
    kicker: 'the workshop',
    groups: [
      { name: 'NSIG', tone: 'rose', items: ['Neuroscience Interest Group'] },
      { name: 'ENTIG', tone: 'gold', items: ['ENT Interest Group'] },
      {
        name: 'a joint clinical workshop',
        tone: 'ivory',
        items: ['Princess Nourah bint Abdulrahman University', 'Saturday 5 December 2026', 'College of Medicine, PNU'],
      },
    ],
  },
};

export const TITLES = {
  vertigo: 'vertigo',
  hearing: 'hearing loss',
  facial: 'facial weakness',
  tinnitus: 'tinnitus',
  headache: 'headache',
  taste: 'taste & smell',
  speakers: 'speakers',
  about: 'about',
  register: 'register',
};
