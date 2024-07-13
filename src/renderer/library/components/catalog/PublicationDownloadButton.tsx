// ==LICENSE-BEGIN==
// Copyright 2017 European Digital Reading Lab. All rights reserved.
// Licensed to the Readium Foundation under one or more contributor license agreements.
// Use of this source code is governed by a BSD-style license
// that can be found in the LICENSE file exposed on Github (readium) in the project repository.
// ==LICENSE-END==

import * as React from "react";
import { connect } from "react-redux";
import classNames from "classnames";
import * as stylesModals from "readium-desktop/renderer/assets/styles/components/modals.scss";
import * as Dialog from "@radix-ui/react-dialog";
import * as PlusIcon from "readium-desktop/renderer/assets/icons/baseline-add-24px.svg";
import SVG from "readium-desktop/renderer/common/components/SVG";
import { apiDispatch } from "readium-desktop/renderer/common/redux/api/api";
import { Dispatch } from "redux";

import { TranslatorProps, withTranslator } from "../../../common/components/hoc/translator";

// eslint-disable-next-line @typescript-eslint/no-empty-interface
interface IBaseProps extends TranslatorProps, ReturnType<typeof mapDispatchToProps> {
}
// IProps may typically extend:
// RouteComponentProps
// ReturnType<typeof mapStateToProps>
// ReturnType<typeof mapDispatchToProps>
// eslint-disable-next-line @typescript-eslint/no-empty-interface
interface IProps extends IBaseProps {
}

export class PublicationDownloadButton extends React.Component<IProps, {ticket: string;}> {

    constructor(props: IProps) {
        super(props);


    this.handleChange = this.handleChange.bind(this);
    this.handleSubmit = this.handleSubmit.bind(this);
      this.state = {
        ticket: ""
      };
    }

    public render(): React.ReactElement<{}> {
        const { __ } = this.props;

        // not necessary as input is located suitably for mouse hit testing
        // htmlFor="epubInput"
        return (<Dialog.Root>
        <Dialog.Trigger asChild>
        <button title={__("header.downloadTitle")} className="R2_CSS_CLASS__FORCE_NO_FOCUS_OUTLINE">
                <SVG ariaHidden={true} svg={PlusIcon} title={__("header.downloadTitle")} />
                <span>{__("header.downloadTitle")}</span>
        </button>
        </Dialog.Trigger>
        <Dialog.Portal>
          <div className={stylesModals.modal_dialog_overlay}></div>
          <Dialog.Content className={classNames(stylesModals.modal_dialog)}>
            <div>
              <form onSubmit={this.handleSubmit}>
                <label>
                  Iroh ticket
                  <textarea
                    value={this.state.ticket}
                    onChange={this.handleChange} />
                </label>
                <input type="submit" value="Download" />
              </form>
            </div>
            </Dialog.Content>
        </Dialog.Portal>
                </Dialog.Root>
        );
    }


  private handleChange(event: React.ChangeEvent<HTMLTextAreaElement>) {
    this.setState({
      ticket: event.target.value
    });
  }

  private handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    alert('A ticket was submitted: ' + this.state.ticket);
    event.preventDefault();
    this.props.import(this.state.ticket);
  }
}

const mapDispatchToProps = (dispatch: Dispatch) => ({
    import: apiDispatch(dispatch)()("publication/importFromIroh"),
});

export default connect(undefined, mapDispatchToProps)(withTranslator(PublicationDownloadButton));
