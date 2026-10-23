import SendOutlinedIcon from "@mui/icons-material/SendOutlined";
import {
  Button,
  CircularProgress,
  IconButton,
  type IconButtonProps,
  type SxProps,
  type Theme,
} from "@mui/material";

type ArrayElement<T> = T extends ReadonlyArray<infer Element> ? Element : never;
type SubmitButtonSxArrayElement = ArrayElement<SxProps<Theme>>;
type SubmitButtonSxArray = ReadonlyArray<SubmitButtonSxArrayElement>;

const sharedSubmitButtonSx: SubmitButtonSxArrayElement = {
  minHeight: 40,
  backgroundColor: "primary.main",
  color: "primary.contrastText",
  "&:hover": {
    backgroundColor: "primary.dark",
  },
  "&.Mui-disabled": {
    backgroundColor: "action.disabledBackground",
    color: "action.disabled",
  },
};

const iconOnlySubmitButtonSx: SubmitButtonSxArrayElement = {
  width: 40,
  height: 40,
  minWidth: 40,
  borderRadius: "50%",
};

const labelledSubmitButtonSx: SubmitButtonSxArrayElement = {
  minWidth: 0,
  px: 2,
  borderRadius: 1,
};

const isSxArray = (
  sx: SxProps<Theme>,
): sx is SubmitButtonSxArray => Array.isArray(sx);

const normalizeSx = (sx: SxProps<Theme> | undefined): SubmitButtonSxArray => {
  if (!sx) {
    return [];
  }

  return isSxArray(sx) ? sx : [sx];
};

export interface SubmitButtonProps extends IconButtonProps {
  loading?: boolean;
}

/** The shared primary submit affordance used by forms and agent replies. */
export const SubmitButton = ({
  children,
  loading = false,
  disabled = false,
  sx,
  "aria-label": ariaLabel,
  ...iconButtonProps
}: SubmitButtonProps) => {
  const content = loading ? (
    <CircularProgress size={16} color="inherit" />
  ) : (
    children ?? <SendOutlinedIcon fontSize="small" />
  );
  const commonProps = {
    ...iconButtonProps,
    "aria-label": ariaLabel ?? "Send",
    disabled: disabled || loading,
    color: "primary" as const,
    size: "small" as const,
    "data-testid": "run-stream-external-reply-submit",
  };

  if (children !== undefined && children !== null) {
    return (
      <Button
        {...commonProps}
        sx={[
          sharedSubmitButtonSx,
          labelledSubmitButtonSx,
          ...normalizeSx(sx),
        ]}
      >
        {content}
      </Button>
    );
  }

  return (
    <IconButton
      {...commonProps}
      sx={[
        sharedSubmitButtonSx,
        iconOnlySubmitButtonSx,
        ...normalizeSx(sx),
      ]}
    >
      {content}
    </IconButton>
  );
};
