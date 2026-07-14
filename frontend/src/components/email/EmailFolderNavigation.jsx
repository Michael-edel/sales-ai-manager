import { EMAIL_FOLDERS, emailFolderStatsForTab } from "./email-utils";

export default function EmailFolderNavigation({
  folder,
  stats,
  filters,
  filtersCollapsed,
  loading,
  onSelectFolder,
  onToggleFilters,
  onRestoreSender,
  canManageRequests,
  isAdmin,
}) {
  return (
    <>
      <div className="email-folder-tabs">
        {EMAIL_FOLDERS.map(([folderKey, label]) => {
          const folderStats = emailFolderStatsForTab(stats, folderKey);
          return (
            <button
              key={folderKey}
              className={`email-folder-tab ${folder === folderKey ? "email-folder-tab-active" : ""}`}
              onClick={() => onSelectFolder(folderKey)}
              disabled={loading}
            >
              <span>{label}</span>
              <small>{folderStats.total || 0}{folderStats.unread ? ` / новых ${folderStats.unread}` : ""}</small>
            </button>
          );
        })}
        {filters.length > 0 && (
          <button
            className={`email-folder-tab email-folder-tab-secondary ${!filtersCollapsed ? "email-folder-tab-active" : ""}`}
            onClick={onToggleFilters}
            disabled={loading}
          >
            <span>Скрытые</span>
            <small>{filters.length} адресов</small>
          </button>
        )}
      </div>

      {filters.length > 0 && !filtersCollapsed && (
        <div className="email-sender-filters">
          <div className="email-sender-filter-list">
            {filters.map((filter) => (
              <span className="email-sender-filter" key={filter.id}>
                {filter.sender_label || filter.sender_email}
                {isAdmin && filter.mailbox_email ? ` (${filter.mailbox_email})` : ""}
                <button
                  type="button"
                  onClick={() => onRestoreSender(filter)}
                  disabled={loading || !canManageRequests}
                >
                  показывать
                </button>
              </span>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
