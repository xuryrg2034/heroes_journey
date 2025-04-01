using System;
using System.Collections.Generic;
using Services;
using UnityEngine;
using UnityEngine.UI;

namespace Entities.Player
{
    public class AbilitiesUIService : MonoBehaviour
    {
        [SerializeField] Button executeButton;
        [SerializeField] Transform containerPrefab;
        [SerializeField] AbilityButton itemPrefab;

        List<AbilityButton> _buttonList = new();
        
        AbilitiesService _abilitiesService;

        public void Init()
        {
            _abilitiesService = ServiceLocator.Get<AbilitiesService>();
            
            foreach (Transform child in containerPrefab)
            {
                Destroy(child.gameObject);
            }

            foreach (var ability in _abilitiesService.Abilities)
            {
                var button = Instantiate(itemPrefab, containerPrefab);
                
                button.Init(ability, HandleClickAbilityButton);
                
                _buttonList.Add(button);
            }
        }
        
        BaseAbility SelectedAbility => _abilitiesService.SelectedAbility;
        
        void Update()
        {
            ToggleExecuteButtonInteractable();
        }

        void ToggleExecuteButtonInteractable()
        {
            var interactable =
                SelectedAbility != null &&
                SelectedAbility.CanBeExecute;

            executeButton.interactable = interactable;
        }

        void HandleClickAbilityButton(BaseAbility ability)
        {
            if (SelectedAbility?.IsInProcess == true) return;

            _abilitiesService.SelectAbility(ability);
        }
    }
}

