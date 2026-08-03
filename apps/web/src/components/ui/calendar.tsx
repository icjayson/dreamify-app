import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker } from "react-day-picker";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

export type CalendarProps = React.ComponentProps<typeof DayPicker> & {
  themeStyles?: React.CSSProperties;
};

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  themeStyles,
  ...props
}: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-3", className)}
      style={themeStyles}
      classNames={{
        months: "flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0",
        month: "space-y-4",
        caption: "flex justify-center pt-1 relative items-center",
        caption_label: "text-sm font-medium [color:var(--title-color)]",
        nav: "space-x-1 flex items-center",
        nav_button: cn(
          buttonVariants({ variant: "outline" }),
          "h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100 [color:var(--title-color)] [border-color:var(--border-card-color)]"
        ),
        nav_button_previous: "absolute left-1",
        nav_button_next: "absolute right-1",
        table: "w-full border-collapse space-y-1",
        head_row: "flex",
        head_cell:
          "rounded-md w-9 font-normal text-[0.8rem] [color:var(--description-color)]",
        row: "flex w-full mt-2",
        cell: "h-9 w-9 text-center text-sm p-0 relative [&:has([aria-selected].day-range-end)]:rounded-r-md [&:has([aria-selected].day-outside)]:[background-color:var(--highlight-color)]/20 [&:has([aria-selected])]:[background-color:var(--highlight-color)]/20 first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md focus-within:relative focus-within:z-20",
        day: cn(
          buttonVariants({ variant: "ghost" }),
          "h-9 w-9 p-0 font-normal aria-selected:opacity-100 [color:var(--title-color)] hover:[background-color:var(--highlight-color)] hover:[color:var(--bg-card-color)]"
        ),
        day_range_start: "![background-color:#ffffff] ![color:var(--bg-card-color)] [border-radius:0.375rem_0_0_0.375rem]",
        day_range_end: "![background-color:#ffffff] ![color:var(--bg-card-color)] [border-radius:0_0.375rem_0.375rem_0]",
        day_selected:
          "[&:not(.day-range-start):not(.day-range-end)]:[background-color:var(--highlight-color)] [&:not(.day-range-start):not(.day-range-end)]:[color:var(--bg-card-color)] hover:[background-color:var(--highlight-color)] hover:[color:var(--bg-card-color)] focus:[background-color:var(--highlight-color)] focus:[color:var(--bg-card-color)]",
        day_today: "[background-color:transparent] [color:var(--title-color)] [border:1px_solid_var(--border-card-color)]",
        day_outside:
          "day-outside [color:var(--description-color)] opacity-50 aria-selected:[background-color:var(--highlight-color)]/30 aria-selected:[color:var(--bg-card-color)] aria-selected:opacity-100",
        day_disabled: "[color:var(--description-color)] opacity-50",
        day_range_middle:
          "![background-color:#a0a0a0] ![color:var(--bg-card-color)]",
        day_hidden: "invisible",
        ...classNames,
      }}
      components={{
        IconLeft: ({ ..._props }) => <ChevronLeft className="h-4 w-4" style={{ color: 'var(--title-color)' }} />,
        IconRight: ({ ..._props }) => <ChevronRight className="h-4 w-4" style={{ color: 'var(--title-color)' }} />,
      }}
      {...props}
    />
  );
}
Calendar.displayName = "Calendar";

export { Calendar };
