/**
 * Friendly random display names. Used when we can't get one from the user
 * directly (wallet sign-up has only an address; Google sign-up has a name
 * we trust). ~40 × 40 × 1000 = 1.6M combos — plenty of head room before
 * collisions matter, and display_name is not a unique column anyway.
 */

const ADJECTIVES = [
  "Lucky", "Brave", "Wild", "Sneaky", "Cool", "Quick", "Spicy", "Silver",
  "Golden", "Crimson", "Stoked", "Cosmic", "Mystic", "Rogue", "Velvet",
  "Lone", "Bold", "Royal", "Frosty", "Mighty", "Tipsy", "Daring", "Crafty",
  "Loaded", "Smooth", "Jolly", "Sharp", "Steady", "Stormy", "Fierce",
  "Reckless", "Vapor", "Echo", "Neon", "Iron", "Steel", "Diamond", "Stellar",
  "Rapid", "Silent",
];

const ANIMALS = [
  "Otter", "Falcon", "Badger", "Yak", "Toad", "Lynx", "Stoat", "Moose",
  "Wolf", "Bear", "Tiger", "Lion", "Eagle", "Hawk", "Fox", "Boar", "Raven",
  "Shark", "Stag", "Orca", "Phoenix", "Dragon", "Wolverine", "Bison", "Cobra",
  "Viper", "Mantis", "Lemur", "Panda", "Koala", "Walrus", "Jaguar", "Cheetah",
  "Owl", "Sparrow", "Hare", "Hyena", "Crow", "Magpie", "Marten",
];

export function generateDisplayName(): string {
  const a = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const b = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  // 3-digit suffix (100–999) keeps it short while bumping the namespace.
  const n = 100 + Math.floor(Math.random() * 900);
  return `${a}${b}${n}`;
}
