using TMPro;
using UnityEngine;
using UnityEngine.UI;

namespace Entities.Player
{
    public class  ExecuteAbilityButton : MonoBehaviour
    {
        [SerializeField] TextMeshProUGUI text;

        Button _button;
        
        AbilitiesService _abilitiesService;
        
        BaseAbility SelectedAbility => _abilitiesService.SelectedAbility;

        void Start()
        {
            _button = GetComponent<Button>();
        }

        public void Initialize(AbilitiesService abilitiesService)
        {
            _abilitiesService = abilitiesService;
        }
        
        public void ToggleInteractable(bool value)
        {
            _button.interactable = value;
        }

        void Update()
        {
            if (SelectedAbility)
            {
                UpdateTitle();   
            }
            else
            {
                SetDefaultTitle();
            }
        }

        void UpdateTitle()
        {
            text.text = SelectedAbility.Title;
        }

        void SetDefaultTitle()
        {
            text.text = "UNKNOWN";
        }
     }
}
