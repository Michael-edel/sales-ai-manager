export function requestVisibleToUser(item, user) {
  return Boolean(item && user && (user.role === "admin"
    || (Number.isSafeInteger(Number(item.assigned_user_id)) && Number(item.assigned_user_id) > 0
      && Number(item.assigned_user_id) === Number(user.id))));
}

export function visibleRequests(items, user) {
  return Array.isArray(items) ? items.filter(item => requestVisibleToUser(item, user)) : [];
}

export function assigneeCaption(item) {
  if (!item?.assigned_user_id) return "Без ответственного";
  const name = String(item.assigned_user_name || "").trim();
  const username = String(item.assigned_user_username || "").trim();
  return name && username && name !== username ? `${name} (${username})` : name || username || `Сотрудник #${item.assigned_user_id}`;
}

export function activeManagers(items) {
  return Array.isArray(items) ? items.filter(item => item.role === "manager" && Number(item.is_active ?? 1) === 1
    && Number.isSafeInteger(Number(item.id)) && Number(item.id) > 0) : [];
}

export function validateAssignment(item, targetId, managers) {
  const id = Number(targetId);
  if (!Number.isSafeInteger(id) || id <= 0 || !activeManagers(managers).some(manager => Number(manager.id) === id))
    return "Выберите действующего менеджера из списка.";
  if (Number(item?.assigned_user_id) === id) return "Этот менеджер уже отвечает за заявку.";
  return "";
}

export function requestIdForAccessError(path, status) {
  if (![403, 404].includes(status)) return null;
  const match = /^\/requests\/(\d+)(?:\/|$)/.exec(path);
  const id = Number(match?.[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function reconcileRequestSelection(current, items, preferred, user) {
  const visible = visibleRequests(items, user);
  if (preferred) return visible.find(item => Number(item.id) === Number(preferred.id)) || null;
  if (current) return visible.find(item => Number(item.id) === Number(current.id)) || null;
  return visible[0] || null;
}
