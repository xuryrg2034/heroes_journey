using System;
using UnityEngine;
using UnityEngine.UI;

namespace Entities.Player
{
    public class AbilityButton : MonoBehaviour
    {
        [SerializeField] GameObject selection;
        [SerializeField] GameObject icon;

        BaseAbility _ability;

        Button _button;

        Action<BaseAbility> _callback;

        void OnDisable()
        {
            _button.onClick.RemoveListener(CallbackInvoke);
            _ability.OnSelected.RemoveListener(HandleAbilitySelection);
        }

        public void Init(BaseAbility ability, Action<BaseAbility> callback)
        {
            _ability = ability;
            _callback = callback;
            _button = GetComponent<Button>();

            PrepareButton();
            PrepareIcon();
        }

        void PrepareButton()
        {
            _button.onClick.AddListener(CallbackInvoke);
            _ability.OnSelected.AddListener(HandleAbilitySelection);
        }

        void PrepareIcon()
        {
            icon.GetComponent<Image>().sprite = _ability.Icon;
        }

        void CallbackInvoke()
        {
            _callback.Invoke(_ability);
        }

        void HandleAbilitySelection(bool value)
        {
            selection.gameObject.SetActive(value);
        }
    }
}