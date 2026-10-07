import { MODES, STYLES } from '../theme.js';
import Popover from './Popover.jsx';

const PaletteIcon = () => (
  <svg
    className="icon"
    viewBox="0 0 16 16"
    width="14"
    height="14"
    aria-hidden="true"
  >
    <path
      fill="currentColor"
      d="M8 1a7 7 0 1 0 0 14c1 0 1.5-.7 1.5-1.4 0-.9-.6-1.1-.6-1.9 0-.7.6-1.2 1.3-1.2H12a3 3 0 0 0 3-3C15 3.6 11.9 1 8 1Zm-4 7a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm2-3a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm4 0a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm2 3a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"
    />
  </svg>
);

function ChoiceGroup({ name, legend, options, value, onChange, variant }) {
  return (
    <fieldset className="choice-group">
      <legend>{legend}</legend>
      <div className={variant}>
        {options.map(option => (
          <label
            key={option.id}
            className={value === option.id ? 'choice selected' : 'choice'}
          >
            <input
              type="radio"
              name={name}
              value={option.id}
              checked={value === option.id}
              onChange={() => onChange(option.id)}
            />
            {variant === 'theme-cards' && (
              <span className={`swatch swatch-${option.id}`} aria-hidden="true">
                <i />
                <i />
              </span>
            )}
            <span className="choice-label">{option.label}</span>
            {option.description && (
              <small className="muted">{option.description}</small>
            )}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export default function AppearanceMenu({ appearance, onChange }) {
  return (
    <Popover label="Appearance" icon={<PaletteIcon />}>
      <div className="appearance">
        <ChoiceGroup
          name="theme-style"
          legend="Theme"
          options={STYLES}
          value={appearance.style}
          onChange={style => onChange({ style })}
          variant="theme-cards"
        />
        <ChoiceGroup
          name="theme-mode"
          legend="Mode"
          options={MODES}
          value={appearance.mode}
          onChange={mode => onChange({ mode })}
          variant="segmented-control"
        />
      </div>
    </Popover>
  );
}
