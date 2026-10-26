import { api } from './client'

export type MealType = 'breakfast' | 'lunch' | 'dinner'

export interface MealOrderOverview {
  serve_date: string
  vendor: string
  location: string
  cutoff: Record<MealType, string>
  meal_type_labels: Record<MealType, string>
  order_qty_by_meal: Record<MealType, number>
  my_confirmed_qty_today: number
  hint: string
}

export interface MealMenuItem {
  id: string
  meal_type: MealType
  name: string
  price: number
  tags: string
}

export interface MealOrderRow {
  id: string
  serve_date: string
  meal_type: MealType
  menu_item_id: string
  dish_name: string
  qty: number
  unit_price: number
  amount: number
  agent_id: string
  agent_name: string
  status: 'confirmed' | 'cancelled'
  remark: string
  created_at: string
  cancelled_at?: string
}

export async function fetchMealOrderOverview(serveDate?: string, agentId?: string) {
  const { data } = await api.get<MealOrderOverview>('/api/meal-order/overview', {
    params: {
      ...(serveDate ? { serve_date: serveDate } : {}),
      ...(agentId ? { agent_id: agentId } : {}),
    },
  })
  return data
}

export async function fetchMealMenu(mealType?: MealType) {
  const { data } = await api.get<{ items: MealMenuItem[] }>('/api/meal-order/menu', {
    params: mealType ? { meal_type: mealType } : {},
  })
  return data.items
}

export async function fetchMealOrders(params: {
  serve_date?: string
  meal_type?: MealType
  agent_id?: string
  status?: 'confirmed' | 'cancelled'
}) {
  const { data } = await api.get<{ items: MealOrderRow[] }>('/api/meal-order/orders', { params })
  return data.items
}

export interface MealOrderCreateBody {
  serve_date: string
  meal_type: MealType
  menu_item_id: string
  qty: number
  remark?: string
  agent_id?: string
  agent_name?: string
}

export async function createMealOrder(body: MealOrderCreateBody) {
  const { data } = await api.post<{ ok: boolean; item: MealOrderRow }>('/api/meal-order/orders', body)
  return data.item
}

export async function cancelMealOrder(orderId: string) {
  const { data } = await api.post<{ ok: boolean; item: MealOrderRow }>(
    `/api/meal-order/orders/${encodeURIComponent(orderId)}/cancel`,
  )
  return data.item
}
