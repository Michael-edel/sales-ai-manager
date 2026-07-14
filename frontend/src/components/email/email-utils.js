export const EMAIL_FOLDERS = [
  ["all", "Все активные"],
  ["inbox", "Полученные"],
  ["in_work", "В работе"],
  ["suppliers", "Поставщики"],
  ["buyers", "Покупатели"],
  ["done", "Закрытые"],
  ["trash", "Удаленные"],
];

export const EMAIL_FOLDER_LABELS = Object.fromEntries(EMAIL_FOLDERS);

export const EMAIL_STATUS_LABELS = {
  received: "Получено",
  in_work: "В работе",
  done: "Закрыто",
  deleted: "Удалено",
};

export function emailFolderStatsForTab(stats, folder) {
  if (folder === "all") {
    return ["inbox", "in_work", "suppliers", "buyers", "done"].reduce((summary, key) => {
      const item = stats?.[key] || { total: 0, unread: 0 };
      summary.total += Number(item.total || 0);
      summary.unread += Number(item.unread || 0);
      return summary;
    }, { total: 0, unread: 0 });
  }

  return stats?.[folder] || { total: 0, unread: 0 };
}

export function emailEmptyMessage(folder, stats) {
  const activeTotal = emailFolderStatsForTab(stats, "all").total;
  const label = EMAIL_FOLDER_LABELS[folder] || "выбранной папке";
  if (activeTotal > 0) {
    return `В папке «${label}» сейчас нет писем. Выберите другую папку выше: письма могли быть перенесены в «Поставщики», «Покупатели», «В работе» или скрыты правилом отправителя.`;
  }
  return "Писем пока нет. Запустите IMAP-ingest для нужного ящика edel.kz и нажмите «Обновить письма».";
}
