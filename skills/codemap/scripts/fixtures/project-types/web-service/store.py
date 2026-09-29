"""SQLite persistence adapter, owned by the HTTP service process."""
import sqlite3


class ReadingStore:
    def __init__(self, path):
        self.connection = sqlite3.connect(path)
        self.connection.row_factory = sqlite3.Row
        self.connection.execute("CREATE TABLE IF NOT EXISTS books (title TEXT PRIMARY KEY, published INTEGER)")
        self.connection.executemany("INSERT OR IGNORE INTO books VALUES (?, ?)", [("The River", 1), ("Unfinished", 0)])
        self.connection.commit()

    def books(self):
        return self.connection.execute("SELECT title, published FROM books ORDER BY title").fetchall()
