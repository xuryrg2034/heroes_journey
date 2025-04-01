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
                
                button.Init(ability, _abilitiesService.SelectAbility);
                
                _buttonList.Add(button);
            }
        }
        
        void Update()
        {
            _toggleExecuteButtonInteractable();
        }

        void _toggleExecuteButtonInteractable()
        {
            var ability = _abilitiesService.SelectedAbility;
            var interactable =
                GameService.CurrentState == GameState.WaitingForInput &&
                ability != null &&
                ability.CanBeExecute;

            executeButton.interactable = interactable;
        }
    }
}

