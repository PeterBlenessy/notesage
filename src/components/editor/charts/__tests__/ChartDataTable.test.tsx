/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@/test/component-harness";
import { ChartDataTable } from "../ChartDataTable";
import type { ChartDataPoint } from "@/lib/chart-types";

const sampleData: ChartDataPoint[] = [
  { category: "North", value: 42 },
  { category: "South", value: 35 },
  { category: "East", value: 28 },
];

describe("ChartDataTable", () => {
  it("renders all data rows", () => {
    const onChange = vi.fn();
    render(
      <ChartDataTable data={sampleData} chartType="bar" onChange={onChange} />
    );

    const inputs = screen.getAllByRole("textbox");
    // 3 category inputs
    expect(inputs).toHaveLength(3);
    expect((inputs[0] as HTMLInputElement).value).toBe("North");
    expect((inputs[1] as HTMLInputElement).value).toBe("South");
    expect((inputs[2] as HTMLInputElement).value).toBe("East");
  });

  it("renders value inputs as number", () => {
    const onChange = vi.fn();
    render(
      <ChartDataTable data={sampleData} chartType="bar" onChange={onChange} />
    );

    const spinbuttons = screen.getAllByRole("spinbutton");
    expect(spinbuttons).toHaveLength(3);
  });

  it("calls onChange when category is edited", () => {
    const onChange = vi.fn();
    render(
      <ChartDataTable data={sampleData} chartType="bar" onChange={onChange} />
    );

    const inputs = screen.getAllByRole("textbox");
    fireEvent.change(inputs[0], { target: { value: "West" } });

    expect(onChange).toHaveBeenCalledTimes(1);
    const updated = onChange.mock.calls[0][0] as ChartDataPoint[];
    expect(updated[0].category).toBe("West");
    expect(updated[0].value).toBe(42); // value preserved
  });

  it("calls onChange when value is edited", () => {
    const onChange = vi.fn();
    render(
      <ChartDataTable data={sampleData} chartType="bar" onChange={onChange} />
    );

    const spinbuttons = screen.getAllByRole("spinbutton");
    fireEvent.change(spinbuttons[0], { target: { value: "99" } });

    expect(onChange).toHaveBeenCalledTimes(1);
    const updated = onChange.mock.calls[0][0] as ChartDataPoint[];
    expect(updated[0].value).toBe(99);
    expect(updated[0].category).toBe("North"); // category preserved
  });

  it("handles non-numeric value input as 0", () => {
    const onChange = vi.fn();
    render(
      <ChartDataTable data={sampleData} chartType="bar" onChange={onChange} />
    );

    const spinbuttons = screen.getAllByRole("spinbutton");
    fireEvent.change(spinbuttons[0], { target: { value: "abc" } });

    const updated = onChange.mock.calls[0][0] as ChartDataPoint[];
    expect(updated[0].value).toBe(0);
  });

  it("adds a row when Add row is clicked", () => {
    const onChange = vi.fn();
    render(
      <ChartDataTable data={sampleData} chartType="bar" onChange={onChange} />
    );

    const addButton = screen.getByRole("button", { name: /add row/i });
    fireEvent.click(addButton);

    expect(onChange).toHaveBeenCalledTimes(1);
    const updated = onChange.mock.calls[0][0] as ChartDataPoint[];
    expect(updated).toHaveLength(4);
    expect(updated[3].category).toBe("");
    expect(updated[3].value).toBe(0);
  });

  it("removes a row when minus button is clicked", () => {
    const onChange = vi.fn();
    render(
      <ChartDataTable data={sampleData} chartType="bar" onChange={onChange} />
    );

    const removeButtons = screen.getAllByTitle("Remove row");
    fireEvent.click(removeButtons[1]); // remove "South"

    expect(onChange).toHaveBeenCalledTimes(1);
    const updated = onChange.mock.calls[0][0] as ChartDataPoint[];
    expect(updated).toHaveLength(2);
    expect(updated[0].category).toBe("North");
    expect(updated[1].category).toBe("East");
  });

  it("does not remove the last row", () => {
    const onChange = vi.fn();
    const singleRow: ChartDataPoint[] = [{ category: "Only", value: 10 }];
    render(
      <ChartDataTable data={singleRow} chartType="bar" onChange={onChange} />
    );

    const removeButton = screen.getByTitle("Remove row");
    expect((removeButton as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows Label header for pie chart type", () => {
    const onChange = vi.fn();
    render(
      <ChartDataTable data={sampleData} chartType="pie" onChange={onChange} />
    );

    expect(screen.getByText("Label")).toBeDefined();
  });

  it("shows Category header for bar chart type", () => {
    const onChange = vi.fn();
    render(
      <ChartDataTable data={sampleData} chartType="bar" onChange={onChange} />
    );

    expect(screen.getByText("Category")).toBeDefined();
  });

  it("shows Label header for donut chart type", () => {
    const onChange = vi.fn();
    render(
      <ChartDataTable data={sampleData} chartType="donut" onChange={onChange} />
    );

    expect(screen.getByText("Label")).toBeDefined();
  });
});
