import appIconUrl from "../assets/app-icon.png";

export function BrandMark(props: { size?: number }) {
  const size = props.size ?? 44;
  return <img aria-hidden="true" className="brand-mark-image" src={appIconUrl} width={size} height={size} draggable={false} />;
}
