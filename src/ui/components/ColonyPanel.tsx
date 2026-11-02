/**
 * The colony at a glance, on the right of the screen:
 *   - the roster: every dwarf, what it's doing and its health (click one to select it);
 *   - the selected dwarf's details: needs, skills, equipment and what it carries;
 *   - storage: how full it is, and everything stored in the Hearth and the chests
 *     (I shows or hides the list).
 * The app refreshes the numbers a few times a second (UiState.colony).
 */
import { keyLabel } from '../../core/actions';
import { t } from '../../core/strings';
import { useCommands, useSettingsStore } from '../commands';
import { useStore } from '../hooks';
import { uiState, type ColonyView, type DwarfSummary } from '../state';
import { Icon } from './Icon';

export function ColonyPanel() {
  const colony = useStore(uiState, (s) => s.colony);
  const selected = useStore(uiState, (s) => s.selectedDwarf);
  if (!colony) return null;
  const dwarf = selected === null ? undefined : colony.dwarves.find((d) => d.id === selected);

  return (
    <>
      <Roster dwarves={colony.dwarves} selected={selected} />
      {dwarf && <DwarfDetails dwarf={dwarf} />}
      <Storage colony={colony} />
    </>
  );
}

function Roster({ dwarves, selected }: { dwarves: DwarfSummary[]; selected: number | null }) {
  const commands = useCommands();
  return (
    <section class="colony-panel panel roster" aria-label={t('colony.roster')} data-testid="roster">
      <h3>
        {t('colony.roster')} <span class="count">{dwarves.filter((d) => !d.dead).length}</span>
      </h3>
      <ul>
        {dwarves.map((dwarf) => (
          <li key={dwarf.id}>
            <button
              type="button"
              class={`roster-row${dwarf.id === selected ? ' selected' : ''}${dwarf.dead ? ' dead' : ''}`}
              aria-pressed={dwarf.id === selected}
              data-testid="roster-dwarf"
              onClick={() => {
                commands.playSound('uiClick');
                commands.selectDwarf(dwarf.id === selected ? null : dwarf.id, true);
              }}
            >
              <span class="swatch" style={`background: ${dwarf.tunic}`} aria-hidden="true" />
              <span class="roster-text">
                <strong>{dwarf.name}</strong>
                <span class={`activity${dwarf.stranded ? ' warn' : ''}`} data-testid="roster-activity">
                  {dwarf.activity}
                </span>
              </span>
              <Meter value={dwarf.health} max={dwarf.maxHealth} kind="health" label={t('dwarf.health')} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function DwarfDetails({ dwarf }: { dwarf: DwarfSummary }) {
  const commands = useCommands();
  return (
    <section class="colony-panel panel dwarf-details" aria-label={dwarf.name} data-testid="dwarf-details">
      <header>
        <h3>{dwarf.name}</h3>
        <button
          type="button"
          class="btn btn-icon btn-small"
          title={t('dwarf.follow')}
          aria-label={t('dwarf.follow')}
          onClick={() => commands.selectDwarf(dwarf.id, true)}
        >
          <Icon name="focus" />
        </button>
        <button
          type="button"
          class="btn btn-icon btn-small"
          title={t('dwarf.close')}
          aria-label={t('dwarf.close')}
          onClick={() => {
            commands.playSound('uiClose');
            commands.selectDwarf(null);
          }}
        >
          <Icon name="close" />
        </button>
      </header>
      <p class={`activity${dwarf.stranded ? ' warn' : ''}`}>{dwarf.activity}</p>

      <dl class="needs">
        <dt>{t('dwarf.health')}</dt>
        <dd>
          <Meter value={dwarf.health} max={dwarf.maxHealth} kind="health" label={t('dwarf.health')} showValue />
        </dd>
        <dt>{t('dwarf.hunger')}</dt>
        <dd>
          <Meter value={dwarf.hunger} max={100} kind="food" label={t('dwarf.hunger')} showValue />
        </dd>
        <dt>{t('dwarf.energy')}</dt>
        <dd>
          <Meter value={dwarf.energy} max={100} kind="energy" label={t('dwarf.energy')} showValue />
        </dd>
      </dl>
      <p class="note">{t('dwarf.needsLater')}</p>

      <h4>{t('dwarf.skills')}</h4>
      <ul class="skills">
        {dwarf.skills.map((skill) => (
          <li key={skill.skill} title={t('dwarf.level', { level: skill.level })}>
            <span>{t(`skill.${skill.skill}`)}</span>
            <span class="level">{skill.level}</span>
            <Meter value={skill.progress} max={1} kind="xp" label={t(`skill.${skill.skill}`)} />
          </li>
        ))}
      </ul>

      <h4>{t('dwarf.equipment')}</h4>
      <ul class="equipment" data-testid="dwarf-equipment">
        {dwarf.equipment.map(({ slot, item, icon }) => (
          <li key={slot}>
            <span>{t(`slot.${slot}`)}</span>
            <span class={item ? 'equipped' : 'empty'}>
              {icon && <img src={icon} alt="" width={16} height={16} />}
              {item ?? t('dwarf.emptySlot')}
            </span>
          </li>
        ))}
      </ul>

      {dwarf.carrying.length > 0 && (
        <p class="carrying">
          {dwarf.carrying.map((load) => (
            <img key={load.name} src={load.icon} alt="" width={20} height={20} />
          ))}
          {dwarf.carrying.length === 1
            ? t('dwarf.carrying', { count: dwarf.carrying[0]!.count, item: dwarf.carrying[0]!.name })
            : t('dwarf.carryingMany', { items: dwarf.carrying.map((load) => `${load.count} × ${load.name}`).join(', ') })}
        </p>
      )}
    </section>
  );
}

/** How full storage is, and (unless hidden with I) a grid of everything in it. */
function Storage({ colony }: { colony: ColonyView }) {
  const commands = useCommands();
  const open = useStore(uiState, (s) => s.storageOpen);
  const bindings = useStore(useSettingsStore(), (s) => s.bindings);
  const { used, capacity } = colony.storage;
  const full = used >= capacity;
  const key = keyLabel(bindings.toggleStorage[0]);
  return (
    <section class={`colony-panel panel storage${open ? '' : ' closed'}`} aria-label={t('colony.storage')} data-testid="storage">
      <h3>
        <button
          type="button"
          class="storage-toggle"
          aria-expanded={open}
          title={t('colony.toggleStorage', { key: key || t('key.unbound') })}
          onClick={() => {
            commands.playSound('uiClick');
            commands.toggleStorage();
          }}
        >
          <Icon name="chest" />
          {t('colony.storage')}
          <span class={`count${full ? ' warn' : ''}`} data-testid="storage-used">
            {t('colony.storageUsed', { used, capacity })}
          </span>
          {key && <kbd>{key}</kbd>}
        </button>
      </h3>
      <span class={`meter meter-storage${full ? ' full' : ''}`} role="meter" aria-label={t('colony.storage')} aria-valuemin={0} aria-valuemax={capacity} aria-valuenow={used}>
        <span class="meter-fill" style={`width: ${Math.round(Math.min(1, capacity > 0 ? used / capacity : 1) * 100)}%`} />
      </span>
      {full && <p class="note warn">{t('colony.storageFull')}</p>}
      {open &&
        (colony.resources.length === 0 ? (
          <p class="note">{t('colony.empty')}</p>
        ) : (
          <ul class="storage-grid">
            {colony.resources.map((entry) => (
              <li key={entry.id} title={`${entry.name}: ${entry.count}`} data-testid={`stored-${entry.id}`}>
                <img src={entry.icon} alt={entry.name} width={20} height={20} />
                <span class="count">{entry.count}</span>
              </li>
            ))}
          </ul>
        ))}
    </section>
  );
}

function Meter({
  value,
  max,
  kind,
  label,
  showValue = false,
}: {
  value: number;
  max: number;
  kind: 'health' | 'food' | 'energy' | 'xp';
  label: string;
  showValue?: boolean;
}) {
  const fraction = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <span class={`meter meter-${kind}`} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
      <span class="meter-fill" style={`width: ${Math.round(fraction * 100)}%`} />
      {showValue && <span class="meter-value">{Math.round(value)}</span>}
    </span>
  );
}
