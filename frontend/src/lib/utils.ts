import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { isToday, isYesterday, isThisWeek, format, isValid } from "date-fns"


export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatUpdatedAt(value?: string) {
  if (!value) return "—"
  const date = new Date(value)
  if (!isValid(date)) return "—"

  if (isToday(date)) return `Today, ${format(date, "h:mm a")}`
  if (isYesterday(date)) return `Yesterday, ${format(date, "h:mm a")}`
  return format(date, "MMM d, yyyy")
}

export function formatDate(value?: string, pattern = "MMM d, yyyy") {
  if (!value) return "—"
  const date = new Date(value)
  return isValid(date) ? format(date, pattern) : "—"
}