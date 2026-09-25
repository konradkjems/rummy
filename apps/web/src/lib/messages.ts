/** Engine messages are English; show Danish to the player. */
export function translate(message: string): string {
  const map: [RegExp, string][] = [
    [/turn you open/, 'Du kan ikke bygge på bordet i den tur, du åbner.'],
    [/does not fit/, 'Kortet passer ikke her.'],
    [/contract/, 'Meldingerne dækker ikke rundens kontrakt.'],
    [/not in hand/, 'Kortet er ikke på din hånd.'],
    [/must open/, 'Du skal åbne med kontrakten først.'],
    [/may not buy/, 'Du kan ikke købe dette kort.'],
    [/No buy window/, 'For sent – kortet er væk.'],
    [/already passed/, 'Du har allerede sagt nej.'],
    [/not player/, 'Det er ikke din tur.'],
    [/Invalid/, 'Det er ikke en gyldig melding.'],
  ];
  for (const [re, text] of map) if (re.test(message)) return text;
  return message;
}
