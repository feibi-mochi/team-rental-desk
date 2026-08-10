import { useId, useState, type InputHTMLAttributes } from "react";
import { Eye, EyeOff } from "lucide-react";

type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;

export function PasswordInput({ id, className, ...props }: PasswordInputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const [visible, setVisible] = useState(false);
  const actionLabel = visible ? "隐藏密码" : "显示密码";

  return (
    <div className="password-field">
      <input
        {...props}
        id={inputId}
        className={className}
        type={visible ? "text" : "password"}
      />
      <button
        type="button"
        className="password-visibility"
        aria-controls={inputId}
        aria-label={actionLabel}
        aria-pressed={visible}
        title={actionLabel}
        onClick={() => setVisible((value) => !value)}
      >
        {visible ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
      </button>
    </div>
  );
}
