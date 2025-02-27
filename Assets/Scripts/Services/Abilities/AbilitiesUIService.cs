using System;
using System.Collections.Generic;
using Abilities.Hero;
using Abilities.UI;
using Services.Abilities;
using TMPro;
using UnityEngine;
using UnityEngine.Events;
using UnityEngine.UI;

namespace Services.Abilities
{
    public class AbilitiesUIService : MonoBehaviour
    {
        [SerializeField] private Transform containerPrefab;
        [SerializeField] private AbilityButton itemPrefab;

        private List<AbilityButton> _buttonList = new();
        private AbilitiesService _abilitiesService;

        private void Start()
        {
            GameService.OnGameStateChange.AddListener(_toggleButtonInteractable);
        }

        public void Init(AbilitiesService service)
        {
            _abilitiesService = service;

            foreach (Transform child in containerPrefab)
            {
                Destroy(child.gameObject);
            }

            foreach (var ability in _abilitiesService.AbilitiesList)
            {
                var button = Instantiate(itemPrefab, containerPrefab);
                
                button.Init(ability, _abilitiesService.SelectAbility);
                
                _buttonList.Add(button);
            }
        }

        private void _toggleButtonInteractable(GameState state)
        {
            foreach (var button in _buttonList)
            {
                button.TryToggleInteractable(state == GameState.WaitingForInput);
            }
        }
    }
}

