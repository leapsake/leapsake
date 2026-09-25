const TEXT = {
  homeTitle: "Leapsake",
  homeTab: "Home",
  searchTab: "Search",
  peopleTitle: "People & Pets",
  peopleTab: "People",
  settings: "Settings",
  gifts: "Gifts",
  holidays: "Holidays",
  tags: "Tags",
  newReminder: "New reminder",
  newPersonOrPet: "New person or pet",
  newGiftIdea: "New gift idea",
} as const;

/** A tab screen's button in the bar. A screen without one is hidden (`href: null`). */
export interface TabButton {
  label: string;
  testID: string;
  glyph: string;
}

/** A header ➕: the create screen it opens, and its accessible name. */
export interface CreateAction {
  href: string;
  label: string;
  testID: string;
}

export interface TabScreen {
  /** The route file's name under `app/(tabs)/`. */
  name: string;
  title?: string;
  headerShown?: false;
  tab?: TabButton;
  /** The `SEARCH_CATEGORIES` key this screen's 🔍 narrows search to. */
  search?: string;
  create?: CreateAction;
}

/** Every screen in the tab navigator, in the order they are declared. */
export const TAB_SCREENS: readonly TabScreen[] = [
  {
    name: "index",
    title: TEXT.homeTitle,
    tab: { label: TEXT.homeTab, testID: "tab-home", glyph: "🏠" },
    create: {
      href: "/reminders/new",
      label: TEXT.newReminder,
      testID: "header-new-home",
    },
  },
  {
    name: "search",
    headerShown: false,
    tab: { label: TEXT.searchTab, testID: "tab-search", glyph: "🔍" },
  },
  {
    name: "people",
    title: TEXT.peopleTitle,
    tab: { label: TEXT.peopleTab, testID: "tab-people", glyph: "👥" },
    search: "people",
    create: {
      href: "/add",
      label: TEXT.newPersonOrPet,
      testID: "header-new-people",
    },
  },
  {
    name: "menu",
    title: TEXT.settings,
    tab: { label: TEXT.settings, testID: "tab-settings", glyph: "⚙️" },
  },
  {
    name: "gifts",
    title: TEXT.gifts,
    search: "gifts",
    create: {
      href: "/gifts/new",
      label: TEXT.newGiftIdea,
      testID: "header-new-gifts",
    },
  },
  { name: "holidays", title: TEXT.holidays, search: "holidays" },
  { name: "tags", title: TEXT.tags, search: "tags" },
];
