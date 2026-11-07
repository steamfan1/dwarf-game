/**
 * New world: pick a seed (the same seed always makes the same world) and a biome. The
 * campaign starts in the forest; each World Gate a colony builds opens the next biome (a
 * biome named in the page address can always be picked, for testing). Dwarves who came
 * through a gate are listed: they are the new world's colony.
 */
import { useState } from 'preact/hooks';
import { randomSeed } from '../../app/worldOptions';
import { t } from '../../core/strings';
import { BIOMES } from '../../sim/content';
import { useCommands } from '../commands';
import { useStore } from '../hooks';
import { uiState, type NewWorldPreset } from '../state';
import { Modal } from './Modal';

const SEED_MAX_LENGTH = 40;

export function NewWorldDialog() {
  const preset = useStore(uiState, (s) => s.newWorld);
  return preset ? <NewWorldForm key={preset.seed} preset={preset} /> : null;
}

function NewWorldForm({ preset }: { preset: NewWorldPreset }) {
  const commands = useCommands();
  const unlocked = useStore(uiState, (s) => s.unlockedBiomes);
  const open = (id: string): boolean => unlocked.includes(id) || id === preset.forcedBiome;
  const [seed, setSeed] = useState(preset.seed);
  const [biome, setBiome] = useState(open(preset.biome) ? preset.biome : (BIOMES.list.find((b) => open(b.id))?.id ?? preset.biome));

  const close = (): void => {
    commands.playSound('uiClose');
    commands.closeNewWorld();
  };
  const create = (): void => {
    commands.playSound('uiClick');
    commands.createWorld({ seed: seed.trim() || randomSeed(), biome, reveal: preset.reveal, hour: preset.hour, travellers: preset.travellers });
  };

  return (
    <Modal
      title={t(preset.travellers.length > 0 ? 'newWorld.travelTitle' : 'newWorld.title')}
      onClose={close}
      wide
      testId="new-world"
      footer={
        <>
          <button type="button" class="btn" onClick={close}>
            {t('newWorld.back')}
          </button>
          <button type="button" class="btn btn-primary" onClick={create} data-testid="create-world">
            {t('newWorld.create')}
          </button>
        </>
      }
    >
      <form
        class="new-world-form"
        onSubmit={(event) => {
          event.preventDefault();
          create();
        }}
      >
        <label class="field">
          <span class="field-label">{t('newWorld.seed')}</span>
          <span class="field-row">
            <input
              type="text"
              class="text-input"
              value={seed}
              maxLength={SEED_MAX_LENGTH}
              spellcheck={false}
              autocomplete="off"
              data-autofocus
              data-testid="seed-input"
              onInput={(event) => setSeed(event.currentTarget.value)}
            />
            <button type="button" class="btn btn-small" onClick={() => setSeed(randomSeed())}>
              {t('newWorld.randomize')}
            </button>
          </span>
          <small class="settings-hint">{t('newWorld.seedHint')}</small>
        </label>

        <fieldset class="biome-choice">
          <legend class="field-label">{t('newWorld.biome')}</legend>
          {BIOMES.list.map((b) => (
            <label key={b.id} class={`biome-option${biome === b.id ? ' selected' : ''}${open(b.id) ? '' : ' locked'}`} title={open(b.id) ? undefined : t('newWorld.locked')}>
              <input
                type="radio"
                name="biome"
                value={b.id}
                checked={biome === b.id}
                disabled={!open(b.id)}
                onChange={() => setBiome(b.id)}
                data-testid={`biome-${b.id}`}
              />
              <span class="biome-name">{b.name}</span>
              <span class="biome-description">{open(b.id) ? b.description : t('newWorld.locked')}</span>
            </label>
          ))}
        </fieldset>
        {preset.travellers.length > 0 && (
          <p class="travellers-note" data-testid="travellers-note">
            {t('newWorld.travellers', { names: preset.travellers.map((traveller) => traveller.name).join(', ') })}
          </p>
        )}
        <p class="settings-hint">{t('newWorld.campaignNote')}</p>
      </form>
    </Modal>
  );
}
