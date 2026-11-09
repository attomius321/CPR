// Settings' Appearance page (V51): this browser's theme, text size, where Git's details go, and the
// intro again.
import { setTextSize, useTextSize, type TextSize } from '../shell/text-size.js';
import { setTheme, useTheme, type Theme } from '../shell/theme.js';
import { setDetailsPlace, useDetailsPlace, type DetailsPlace } from '../history/details.js';
import { startIntro } from '../intro/intro.js';
import { SettingsCard } from './SettingsCard.js';

const THEMES: { theme: Theme; label: string }[] = [
  { theme: 'dark', label: 'Dark' },
  { theme: 'light', label: 'Light' },
  { theme: 'system', label: 'System' },
];

/** The text size (V87c, decision 763): the body at 14, 15 or 16 px. */
const TEXT_SIZE_CHOICES: { size: TextSize; label: string }[] = [
  { size: 'compact', label: 'Compact' },
  { size: 'default', label: 'Default' },
  { size: 'large', label: 'Large' },
];

/** Where Git's details pane goes (V66b, decision 478). */
const PLACES: { place: DetailsPlace; label: string }[] = [
  { place: 'right', label: 'On the right' },
  { place: 'below', label: 'Below the commits' },
];

/**
 * This browser's Appearance (V51, decision 388; in the head before): the page's theme (V29b,
 * decision 179), dark unless chosen, the text size (V87c), where Git's commit details go (V66b),
 * and the first-time intro again (V39), as often as one likes.
 */
export function AppearancePage({ onBack }: { onBack: () => void }) {
  const theme = useTheme();
  const textSize = useTextSize();
  const place = useDetailsPlace();
  return (
    <SettingsCard label="Appearance" title="Appearance" onBack={onBack}>
      <div className="settings-rows">
        <section className="settings-part" aria-label="Theme">
          <h3 id="settings-theme">Theme</h3>
          <span className="scopes" role="group" aria-labelledby="settings-theme">
            {THEMES.map((choice) => (
              <button
                key={choice.theme}
                type="button"
                className={theme === choice.theme ? 'scope active' : 'scope'}
                aria-pressed={theme === choice.theme}
                onClick={() => setTheme(choice.theme)}
              >
                {choice.label}
              </button>
            ))}
          </span>
          <p className="settings-row-note">Kept in this browser.</p>
        </section>
        <section className="settings-part" aria-label="Text size">
          <h3 id="settings-text-size">Text size</h3>
          <span className="scopes" role="group" aria-labelledby="settings-text-size">
            {TEXT_SIZE_CHOICES.map((choice) => (
              <button
                key={choice.size}
                type="button"
                className={textSize === choice.size ? 'scope active' : 'scope'}
                aria-pressed={textSize === choice.size}
                onClick={() => setTextSize(choice.size)}
              >
                {choice.label}
              </button>
            ))}
          </span>
          <p className="settings-row-note">
            The text a step smaller or larger; rows, buttons, the graph and the terminal keep their
            sizes. Kept in this browser.
          </p>
        </section>
        <section className="settings-part" aria-label="Commit details">
          <h3 id="settings-details">Commit details</h3>
          <span className="scopes" role="group" aria-labelledby="settings-details">
            {PLACES.map((choice) => (
              <button
                key={choice.place}
                type="button"
                className={place === choice.place ? 'scope active' : 'scope'}
                aria-pressed={place === choice.place}
                onClick={() => setDetailsPlace(choice.place)}
              >
                {choice.label}
              </button>
            ))}
          </span>
          <p className="settings-row-note">
            Where Git shows the selected commit: beside its rows or under them. Kept in this
            browser.
          </p>
        </section>
        <section className="settings-part" aria-label="Intro">
          <h3>Intro</h3>
          <button
            type="button"
            className="button secondary"
            onClick={() => startIntro({ record: false })}
          >
            Play the intro
          </button>
          <p className="settings-row-note">The first-time intro again; nothing is recorded.</p>
        </section>
      </div>
    </SettingsCard>
  );
}
