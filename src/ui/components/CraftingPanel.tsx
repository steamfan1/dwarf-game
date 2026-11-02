/**
 * The crafting panel (K): every recipe, grouped by where it's made (by hand, at the
 * workbench, the furnace...), and the queue of orders. Queuing a recipe only asks for it:
 * a free dwarf fetches the materials from storage, walks to a station of the right kind
 * and makes it, then puts what it made away. Recipes whose station hasn't been built yet
 * say so; materials the colony is short of are shown in red.
 *
 * The game keeps running while the panel is open.
 */
import { keyLabel } from '../../core/actions';
import { t } from '../../core/strings';
import { useCommands, useSettingsStore } from '../commands';
import { useStore } from '../hooks';
import { uiState, type Catalogue, type CraftOrderView, type RecipeView } from '../state';
import { Icon } from './Icon';

/** How many crafts each "queue" button adds. */
const BATCHES = [1, 5] as const;

export function CraftingPanel() {
  const commands = useCommands();
  const catalogue = useStore(uiState, (s) => s.catalogue);
  const colony = useStore(uiState, (s) => s.colony);
  const bindings = useStore(useSettingsStore(), (s) => s.bindings);
  if (!catalogue || !colony) return null;
  const stock = new Map(colony.resources.map((entry) => [entry.id, entry.count]));
  const key = keyLabel(bindings.toggleCrafting[0]);

  return (
    <section class="crafting panel" aria-label={t('crafting.title')} data-testid="crafting-panel">
      <header>
        <h2>
          <Icon name="craft" /> {t('crafting.title')}
          {key && <kbd>{key}</kbd>}
        </h2>
        <button
          type="button"
          class="btn btn-icon btn-small"
          title={t('crafting.close')}
          aria-label={t('crafting.close')}
          onClick={() => {
            commands.playSound('uiClose');
            commands.toggleCrafting();
          }}
        >
          <Icon name="close" />
        </button>
      </header>

      <div class="crafting-body">
        <div class="recipes">
          {recipeGroups(catalogue).map(({ station, name, recipes }) => {
            const missing = station !== null && (colony.stations[station] ?? 0) === 0;
            return (
              <section key={station ?? 'hand'} class={`recipe-group${missing ? ' no-station' : ''}`}>
                <h3>{name}</h3>
                {missing && <p class="note warn">{t('crafting.noStation', { station: name })}</p>}
                <ul>
                  {recipes.map((recipe) => (
                    <RecipeRow key={recipe.id} recipe={recipe} stock={stock} />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>

        <section class="queue" aria-label={t('crafting.queue')} data-testid="craft-queue">
          <h3>{t('crafting.queue')}</h3>
          {colony.orders.length === 0 ? (
            <p class="note">{t('crafting.queueEmpty')}</p>
          ) : (
            <ul>
              {colony.orders.map((order) => (
                <OrderRow key={order.id} order={order} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </section>
  );
}

function recipeGroups(catalogue: Catalogue): Array<{ station: string | null; name: string; recipes: RecipeView[] }> {
  const groups = [{ station: null as string | null, name: t('crafting.byHand') }, ...catalogue.stations.map(({ id, name }) => ({ station: id as string | null, name }))];
  return groups
    .map((group) => ({ ...group, recipes: catalogue.recipes.filter((recipe) => recipe.station === group.station) }))
    .filter((group) => group.recipes.length > 0);
}

function RecipeRow({ recipe, stock }: { recipe: RecipeView; stock: ReadonlyMap<string, number> }) {
  const commands = useCommands();
  const enough = recipe.inputs.every((input) => (stock.get(input.id) ?? 0) >= input.count);
  return (
    <li class={`recipe${enough ? '' : ' short'}`} data-testid={`recipe-${recipe.id}`}>
      <img class="item-icon" src={recipe.output.icon} alt="" width={30} height={30} />
      <span class="recipe-main">
        <span class="recipe-name">
          <strong>{recipe.output.name}</strong>
          {recipe.output.count > 1 && <span class="makes">{t('crafting.makes', { count: recipe.output.count })}</span>}
        </span>
        <span class="inputs">
          {recipe.inputs.map((input) => {
            const have = stock.get(input.id) ?? 0;
            return (
              <span key={input.id} class={`input${have < input.count ? ' short' : ''}`} title={t('crafting.have', { have, need: input.count, item: input.name })}>
                <img class="item-icon small" src={input.icon} alt={input.name} width={20} height={20} />
                {input.count}
              </span>
            );
          })}
          <span class="time">{t('crafting.time', { seconds: recipe.seconds })}</span>
        </span>
      </span>
      <span class="add">
        {BATCHES.map((count) => (
          <button
            key={count}
            type="button"
            class="btn btn-small"
            title={t('crafting.addTip', { count, item: recipe.output.name })}
            data-testid={`queue-${recipe.id}-${count}`}
            onClick={() => {
              commands.playSound('uiClick');
              commands.queueCraft(recipe.id, count);
            }}
          >
            {t('crafting.add', { count })}
          </button>
        ))}
      </span>
    </li>
  );
}

function OrderRow({ order }: { order: CraftOrderView }) {
  const commands = useCommands();
  const left = order.count - order.made;
  const status =
    order.status === 'no-station' ? t('crafting.status.no-station', { station: order.station ?? '' }) : t(`crafting.status.${order.status}`);
  return (
    <li class={`order status-${order.status}`} data-testid="craft-order">
      <img class="item-icon" src={order.icon} alt="" width={30} height={30} />
      <span class="order-text">
        <strong>
          {order.name}
          {order.outputCount > 1 && <span class="makes"> {t('crafting.makes', { count: order.outputCount })}</span>}
        </strong>
        <span class="order-status" data-testid="craft-order-status">
          {t('crafting.made', { made: order.made, count: order.count })} · {status}
        </span>
        {order.progress !== null && (
          <span class="meter meter-xp" role="meter" aria-valuemin={0} aria-valuemax={1} aria-valuenow={order.progress}>
            <span class="meter-fill" style={`width: ${Math.round(order.progress * 100)}%`} />
          </span>
        )}
      </span>
      <span class="order-buttons">
        <button
          type="button"
          class="btn btn-icon btn-small"
          title={t('crafting.less')}
          aria-label={t('crafting.less')}
          onClick={() => {
            commands.playSound('uiClick');
            commands.setCraftRemaining(order.id, left - 1);
          }}
        >
          <Icon name="minus" />
        </button>
        <button
          type="button"
          class="btn btn-icon btn-small"
          title={t('crafting.more')}
          aria-label={t('crafting.more')}
          onClick={() => {
            commands.playSound('uiClick');
            commands.setCraftRemaining(order.id, left + 1);
          }}
        >
          <Icon name="plus" />
        </button>
        <button
          type="button"
          class="btn btn-icon btn-small"
          title={t('crafting.cancel')}
          aria-label={t('crafting.cancel')}
          data-testid="craft-order-cancel"
          onClick={() => {
            commands.playSound('uiClose');
            commands.cancelCraft(order.id);
          }}
        >
          <Icon name="close" />
        </button>
      </span>
    </li>
  );
}
