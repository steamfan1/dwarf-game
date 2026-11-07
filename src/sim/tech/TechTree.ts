/**
 * The tech tree (src/data/tech.json): tiers of recipes the colony unlocks one after the
 * other. Every recipe belongs to exactly one tier. The colony starts with the first tier's
 * recipes; making an item for the first time earns research, and filling a tier's research
 * bar unlocks the next tier's recipes. Some tiers bring new dwarves to the colony, and the
 * last one unlocks the World Gate.
 *
 * Pure: no Phaser and no DOM.
 */
import { Validator } from '../../core/validate';
import type { RecipeBook } from '../crafting/Recipes';

export interface TechTier {
  readonly index: number;
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** Research needed to fill this tier and reach the next (0 for the last tier). */
  readonly research: number;
  /** Research earned by making an item from one of this tier's recipes for the first time. */
  readonly newItemResearch: number;
  /** Dwarves who come to join the colony when this tier is reached. */
  readonly dwarves: number;
  /** The recipes it unlocks, by index in the RecipeBook. */
  readonly recipes: readonly number[];
}

export class TechTree {
  readonly tiers: readonly TechTier[];
  /** The tier each recipe belongs to, by recipe index. */
  readonly recipeTier: readonly number[];

  private constructor(tiers: TechTier[], recipeTier: number[]) {
    this.tiers = tiers;
    this.recipeTier = recipeTier;
  }

  /** Validate raw JSON against the recipes: every recipe must be in exactly one tier. */
  static fromJson(data: unknown, recipes: RecipeBook): TechTree {
    const v = new Validator('tech.json');
    const root = v.object(data, '');
    const rawTiers = v.array(root?.tiers, 'tiers');
    if (rawTiers.length < 2) v.problem('tiers needs at least two tiers');
    const recipeTier = recipes.recipes.map(() => -1);
    const tiers = rawTiers.map((raw, index): TechTier => {
      const path = `tiers[${index}]`;
      const o = v.object(raw, path);
      const last = index === rawTiers.length - 1;
      const ids = v.array(o?.recipes, `${path}.recipes`);
      const list: number[] = [];
      ids.forEach((rawId, i) => {
        const id = v.identifier(rawId, `${path}.recipes[${i}]`);
        if (!recipes.has(id)) {
          v.problem(`${path}.recipes[${i}] refers to unknown recipe "${id}"`);
          return;
        }
        const recipe = recipes.get(id).index;
        if (recipeTier[recipe] !== -1) v.problem(`recipe "${id}" is in more than one tier`);
        recipeTier[recipe] = index;
        list.push(recipe);
      });
      return {
        index,
        id: v.identifier(o?.id, `${path}.id`),
        name: v.string(o?.name, `${path}.name`),
        description: v.string(o?.description, `${path}.description`),
        // The last tier has nothing after it to unlock.
        research: last ? 0 : Math.round(v.number(o?.research, `${path}.research`, 1, 100_000)),
        newItemResearch: Math.round(v.number(o?.newItemResearch, `${path}.newItemResearch`, 0, 100_000)),
        dwarves: Math.round(v.number(o?.dwarves ?? 0, `${path}.dwarves`, 0, 20)),
        recipes: list,
      };
    });
    recipes.recipes.forEach((recipe, i) => {
      if (recipeTier[i] === -1) v.problem(`recipe "${recipe.id}" isn't in any tier (every recipe must be unlocked somewhere)`);
    });
    v.unique(
      tiers.map((tier) => tier.id),
      'tier id',
    );
    v.throwIfProblems();
    return new TechTree(tiers, recipeTier);
  }

  get lastTier(): number {
    return this.tiers.length - 1;
  }

  /** Research a recipe's item earns the first time it's made. */
  researchFor(recipe: number): number {
    return this.tiers[this.recipeTier[recipe] ?? 0]?.newItemResearch ?? 0;
  }
}

/** Where the colony stands in the tech tree, as saved. */
export interface ResearchState {
  tier: number;
  points: number;
  /** Items made at least once, by items.json id. */
  crafted: string[];
}

/**
 * The colony's progress through the tech tree: the tier it has reached, the research
 * gathered towards the next, and every item it has made so far.
 */
export class Research {
  readonly tree: TechTree;
  /** The highest tier reached (0 is the first). */
  tier = 0;
  /** Research gathered towards filling the current tier. */
  points = 0;
  /** Items made at least once (item numbers). */
  readonly crafted = new Set<number>();
  /** Bumped on every change (for the tech tree panel). */
  version = 0;

  constructor(tree: TechTree) {
    this.tree = tree;
  }

  /** Whether a recipe's tier has been reached. */
  unlocked(recipe: number): boolean {
    return (this.tree.recipeTier[recipe] ?? Infinity) <= this.tier;
  }

  /** The last tier is reached: nothing more to unlock. */
  get complete(): boolean {
    return this.tier >= this.tree.lastTier;
  }

  /** Research the current tier needs to fill (0 once the last tier is reached). */
  get needed(): number {
    return this.complete ? 0 : this.tree.tiers[this.tier]!.research;
  }

  /**
   * A craft of a recipe finished, making `item`. The first time an item is made it earns
   * research; returns how much, and the tiers that research reached (usually none).
   */
  recordCraft(recipe: number, item: number): { earned: number; reached: TechTier[] } {
    if (this.crafted.has(item)) return { earned: 0, reached: [] };
    this.crafted.add(item);
    const earned = this.tree.researchFor(recipe);
    this.version++;
    return { earned, reached: this.add(earned) };
  }

  /** Add research; overflow carries on into the next tier. Returns the tiers reached. */
  add(points: number): TechTier[] {
    const reached: TechTier[] = [];
    this.points += points;
    while (!this.complete && this.points >= this.needed) {
      this.points -= this.needed;
      this.tier++;
      reached.push(this.tree.tiers[this.tier]!);
    }
    if (this.complete) this.points = 0;
    this.version++;
    return reached;
  }

  /** Debug: jump straight to a tier. Returns the tiers passed on the way. */
  reach(tier: number): TechTier[] {
    const reached: TechTier[] = [];
    const target = Math.max(0, Math.min(this.tree.lastTier, Math.round(tier)));
    while (this.tier < target) {
      this.tier++;
      reached.push(this.tree.tiers[this.tier]!);
    }
    this.points = 0;
    this.version++;
    return reached;
  }

  save(itemId: (item: number) => string): ResearchState {
    return { tier: this.tier, points: this.points, crafted: [...this.crafted].map(itemId) };
  }

  /** Load saved progress; items no longer in the game are skipped. */
  restore(state: ResearchState, itemNumber: (id: string) => number | undefined): void {
    this.tier = Math.max(0, Math.min(this.tree.lastTier, Math.round(state.tier)));
    this.points = Math.max(0, state.points);
    this.crafted.clear();
    for (const id of state.crafted) {
      const item = itemNumber(id);
      if (item !== undefined) this.crafted.add(item);
    }
    this.version++;
  }
}
