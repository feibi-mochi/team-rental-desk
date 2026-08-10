import { Check, Palette } from "lucide-react";
import { PALETTES } from "../ui";

export function ThemePicker(props: {
  current: string;
  open: boolean;
  onToggle: () => void;
  onSelect: (key: string) => void;
}) {
  const name = PALETTES.find((item) => item.key === props.current)?.name ?? "蓝绿";
  return (
    <div className="theme-picker">
      <button className="palette-button labeled" title="选择颜色" onClick={props.onToggle}>
        <Palette size={16} /><span>{name}</span>
      </button>
      {props.open ? (
        <div className="palette-popover">
          <strong>选择你的颜色</strong>
          <div className="swatch-grid">
            {PALETTES.map((palette) => (
              <button
                key={palette.key}
                className={props.current === palette.key ? "swatch selected" : "swatch"}
                style={{ backgroundColor: palette.color }}
                title={palette.name}
                onClick={() => props.onSelect(palette.key)}
              >
                {props.current === palette.key ? <Check size={20} /> : null}
              </button>
            ))}
          </div>
          <span>当前：{name}</span>
        </div>
      ) : null}
    </div>
  );
}
