/**
 * New world: pick a seed (the same seed always makes the same world) and a biome.
 * In the full campaign, biomes unlock as the colony passes through the World Gate
 * (Milestone 6); until then both can be chosen here for testing.
 */
import { useState } from 'preact/hooks';
import { randomSeed } from '../../app/worldOptions';
import { t } from '../../core/strings';
import { BIOMES } from '../../sim/content';
import { useCommands } from '../commands';
import { useStore } from '../hooks';
import { uiState } from '../state';
import { Modal } from './Modal';

const SEED_MAX_LENGTH = 40;

export function NewWorldDialog() {
  const preset = useStore(uiState, (s) => s.newWorld);
  return preset ? <NewWorldForm key={preset.seed} preset={preset} /> : null;
}

function NewWorldForm({ preset }: { preset: { seed: string; biome: string; reveal: boolean; hour: number | null } }) {
  const commands = useCommands();
  const [seed, setSeed] = useState(preset.seed);
  const [biome, setBiome] = useState(preset.biome);

  const close = (): void => {
    commands.playSound('uiClose');
    commands.closeNewWorld();
  };
  const create = (): void => {
    commands.playSound('uiClick');
    commands.createWorld({ seed: seed.trim() || randomSeed(), biome, reveal: preset.reveal, hour: preset.hour });
  };

  return (
    <Modal
      title={t('newWorld.title')}
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
            <label key={b.id} class={`biome-option${biome === b.id ? ' selected' : ''}`}>
              <input
                type="radio"
                name="biome"
                value={b.id}
                checked={biome === b.id}
                onChange={() => setBiome(b.id)}
                data-testid={`biome-${b.id}`}
              />
              <span class="biome-name">{b.name}</span>
              <span class="biome-description">{b.description}</span>
            </label>
          ))}
        </fieldset>
        <p class="settings-hint">{t('newWorld.campaignNote')}</p>
      </form>
    </Modal>
  );
}
