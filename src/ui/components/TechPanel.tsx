/**
 * The tech tree panel (R): every tier, the recipes it unlocks and which of their items the
 * colony has made, and the research bar of the tier in progress. Making an item for the
 * first time earns research; a full bar unlocks the next tier's recipes, and some tiers
 * bring new dwarves. The last unlocks the World Gate.
 *
 * The game keeps running while the panel is open.
 */
import { keyLabel } from '../../core/actions';
import { t } from '../../core/strings';
import { useCommands, useSettingsStore } from '../commands';
import { useStore } from '../hooks';
import { uiState, type RecipeView } from '../state';
import { Icon } from './Icon';

export function TechPanel() {
  const commands = useCommands();
  const catalogue = useStore(uiState, (s) => s.catalogue);
  const research = useStore(uiState, (s) => s.research);
  const bindings = useStore(useSettingsStore(), (s) => s.bindings);
  if (!catalogue || !research) return null;
  const key = keyLabel(bindings.toggleTech[0]);
  const crafted = new Set(research.crafted);
  const recipes = new Map(catalogue.recipes.map((recipe) => [recipe.id, recipe]));
  const last = catalogue.tiers.length - 1;

  return (
    <section class="tech panel" aria-label={t('tech.title')} data-testid="tech-panel">
      <header>
        <h2>
          <Icon name="tech" /> {t('tech.title')}
          {key && <kbd>{key}</kbd>}
        </h2>
        <button
          type="button"
          class="btn btn-icon btn-small"
          title={t('tech.close')}
          aria-label={t('tech.close')}
          onClick={() => {
            commands.playSound('uiClose');
            commands.toggleTech();
          }}
        >
          <Icon name="close" />
        </button>
      </header>
      <p class="tech-intro">{t('tech.intro')}</p>
      <ol class="tiers">
        {catalogue.tiers.map((tier, index) => {
          const state = index < research.tier ? 'reached' : index === research.tier ? 'current' : 'locked';
          const reward = index === last ? t('tech.gate') : tier.dwarves === 1 ? t('tech.dwarf') : tier.dwarves > 1 ? t('tech.dwarves', { count: tier.dwarves }) : null;
          return (
            <li key={tier.name} class={`tier ${state}`} data-testid={`tier-${index}`}>
              <div class="tier-head">
                <span class="tier-number">{t('tech.tier', { n: index + 1 })}</span>
                <strong class="tier-name">{tier.name}</strong>
                {reward && <span class="tier-reward">{reward}</span>}
                <span class="tier-state">{t(`tech.${state}`)}</span>
              </div>
              <p class="tier-description">{tier.description}</p>
              {state === 'current' &&
                (research.needed > 0 ? (
                  <div class="tier-progress" data-testid="tech-progress">
                    <span class="meter meter-xp" role="meter" aria-valuemin={0} aria-valuemax={research.needed} aria-valuenow={research.points}>
                      <span class="meter-fill" style={`width: ${Math.min(100, Math.round((research.points / research.needed) * 100))}%`} />
                    </span>
                    <span class="tier-progress-text">{t('tech.progress', { points: research.points, needed: research.needed })}</span>
                  </div>
                ) : (
                  <p class="note">{t('tech.complete')}</p>
                ))}
              <ul class="tier-items">
                {tier.recipes.map((id) => {
                  const recipe = recipes.get(id);
                  return recipe ? <TierItem key={id} recipe={recipe} made={crafted.has(recipe.output.id)} locked={state === 'locked'} tierName={tier.name} /> : null;
                })}
              </ul>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function TierItem({ recipe, made, locked, tierName }: { recipe: RecipeView; made: boolean; locked: boolean; tierName: string }) {
  const name = recipe.output.name;
  const title = locked
    ? t('tech.lockedItem', { item: name, tier: tierName })
    : made
      ? t('tech.made', { item: name, points: recipe.research })
      : t('tech.notMade', { item: name, points: recipe.research });
  return (
    <li class={`tier-item${made ? ' made' : ''}${locked ? ' locked' : ''}`} title={title} data-testid={`tech-item-${recipe.id}`}>
      <img class="item-icon" src={recipe.output.icon} alt={name} width={30} height={30} />
      {made && <span class="tick" aria-hidden="true" />}
    </li>
  );
}
