"""Reading-list policy: only published books are visible to readers."""


def reading_list(store):
    return [book["title"] for book in store.books() if book["published"]]
